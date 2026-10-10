/**
 * File-Based Session Storage Backend
 *
 * Persists sessions to a JSON file for survival across server restarts.
 * Suitable for single-instance deployments without external database.
 *
 * Features:
 * - Every OAuth record (client, session, flow, code) and every transition of one is
 *   written through before it is reported; cleanup and MCP transport mappings are
 *   saved debounced
 * - Periodic auto-save interval
 * - Atomic file writes (write to temp, then rename)
 * - Data version migration support
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  OAuthSession,
  DeviceFlowState,
  AuthCodeFlowState,
  AuthorizationCode,
  RegisteredOAuthClient,
} from '../types';
import {
  SessionStorageBackend,
  SessionStorageStats,
  StorageData,
  STORAGE_DATA_VERSION,
} from './types';
import { MemoryStorageBackend } from './memory';
import { logInfo, logDebug, logError, logWarn } from '../../logger';

export interface FileStorageOptions {
  /** Path to the storage file */
  filePath: string;
  /** Auto-save interval in milliseconds (default: 30000 = 30 seconds) */
  saveInterval?: number;
  /** Debounce delay for change-triggered saves (default: 1000ms) */
  saveDebounce?: number;
}

function isPresent<T>(record: T | undefined): record is T {
  return record !== undefined;
}

/**
 * Flush a directory entry change (the rename) to disk. Windows cannot open a directory
 * for syncing; NTFS journals the rename itself.
 */
async function syncDirectory(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await fs.promises.open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileStorageBackend implements SessionStorageBackend {
  readonly type = 'file' as const;

  private memory: MemoryStorageBackend;
  private filePath: string;
  private saveInterval: number;
  private saveDebounce: number;
  private saveIntervalId: ReturnType<typeof setInterval> | null = null;
  private saveDebounceId: ReturnType<typeof setTimeout> | null = null;
  private pendingSave = false;
  private initialized = false;
  /** Tail of the serialized file writes */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileStorageOptions) {
    // Use memory backend internally as cache, but suppress its logging
    this.memory = new MemoryStorageBackend({ silent: true });
    this.filePath = options.filePath;
    this.saveInterval = options.saveInterval ?? 30000;
    this.saveDebounce = options.saveDebounce ?? 1000;
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    let dirCreated = false;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      dirCreated = true;
      logInfo('Created storage directory', { dir });
    }

    // Load existing data if file exists
    const fileExists = fs.existsSync(this.filePath);
    if (fileExists) {
      const stats = fs.statSync(this.filePath);
      logInfo('Found existing session file', {
        filePath: this.filePath,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      });
      await this.loadFromFile();
    } else {
      logInfo('No existing session file, will create on first save', {
        filePath: this.filePath,
      });
    }

    // Verify we can write to the file
    try {
      const testPath = `${this.filePath}.test`;
      fs.writeFileSync(testPath, 'test', 'utf-8');
      fs.unlinkSync(testPath);
      logDebug('Write access verified', { filePath: this.filePath });
    } catch (error) {
      logError('Cannot write to storage file path - sessions will NOT persist!', {
        err: error as Error,
        filePath: this.filePath,
      });
      throw new Error(`File storage path not writable: ${this.filePath}`, { cause: error });
    }

    // Initialize memory backend (starts cleanup interval)
    await this.memory.initialize();

    // Start auto-save interval
    this.startSaveInterval();

    this.initialized = true;
    logInfo('File storage backend initialized', {
      filePath: this.filePath,
      dirCreated,
      fileExisted: fileExists,
    });
  }

  private async loadFromFile(): Promise<void> {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(content) as StorageData;

      // Validate version
      if (data.version !== STORAGE_DATA_VERSION) {
        logWarn('Storage file version mismatch, migrating data', {
          fileVersion: data.version,
          currentVersion: STORAGE_DATA_VERSION,
        });
        // Future: add migration logic here
      }

      // Filter expired data before import
      const now = Date.now();
      const validSessions = data.sessions.filter((s) => {
        // Sessions are valid for 7 days
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        return s.createdAt + maxAge > now;
      });

      const validDeviceFlows = data.deviceFlows.filter((d) => d.flow.expiresAt > now);
      const validAuthCodeFlows = data.authCodeFlows.filter((a) => a.flow.expiresAt > now);
      const validAuthCodes = data.authCodes.filter((a) => a.expiresAt > now);

      // Import into memory
      this.memory.importData({
        sessions: validSessions,
        deviceFlows: validDeviceFlows,
        authCodeFlows: validAuthCodeFlows,
        authCodes: validAuthCodes,
        mcpSessionMappings: data.mcpSessionMappings,
        clients: data.clients,
      });

      const stats = await this.memory.getStats();
      logInfo('Loaded sessions from file', {
        loadedSessions: stats.sessions,
        expiredSessions: data.sessions.length - validSessions.length,
        loadedDeviceFlows: stats.deviceFlows,
        loadedAuthCodes: stats.authCodes,
      });
    } catch (error) {
      logError('Failed to load sessions from file', {
        err: error as Error,
        filePath: this.filePath,
      });
      // Start fresh on load error
    }
  }

  private async saveToFile(): Promise<void> {
    try {
      await this.writeSnapshot();
    } catch (error) {
      logError('Failed to save sessions to file', {
        err: error as Error,
        filePath: this.filePath,
      });
    }
  }

  /**
   * Write the current state now, replacing any pending debounced save. Single-use
   * transitions (consumed codes and flows, rotated refresh tokens, revoked sessions) are
   * reported only after this succeeds, so a crash cannot bring them back.
   */
  private async persistNow(): Promise<void> {
    this.cancelPendingSave();
    await this.writeSnapshot();
  }

  private cancelPendingSave(): void {
    if (this.saveDebounceId) {
      clearTimeout(this.saveDebounceId);
      this.saveDebounceId = null;
    }
    this.pendingSave = false;
  }

  /**
   * Run `task` as the next step of the write queue: steps run one at a time in call order,
   * so concurrent writes never share the temp file. A failed step is reported to its
   * caller; the next one still runs.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const step = this.writeQueue.then(task);
    this.writeQueue = step.then(
      () => undefined,
      () => undefined,
    );
    return step;
  }

  /** Atomically replace the file with the state at the time the write runs. */
  private writeSnapshot(): Promise<void> {
    return this.enqueue(() => this.writeState());
  }

  /**
   * A single-use transition as one step of the write queue: the change, the write of the
   * resulting state and, when the write fails, the undo of the change. No other write can
   * capture the changed state in between, so a transition reported as failed is never
   * persisted. `changed` tells whether there is anything to write.
   */
  private transition<T, Changed extends T>(
    change: () => Promise<T>,
    changed: (result: T) => result is Changed,
    undo: (result: Changed) => Promise<unknown>,
  ): Promise<T> {
    this.cancelPendingSave();
    return this.enqueue(async () => {
      const result = await change();
      if (!changed(result)) return result;
      try {
        await this.writeState();
      } catch (error: unknown) {
        // The caller never used the result, so the code, flow or refresh token it would
        // have spent stays usable for the retry.
        await undo(result);
        throw error;
      }
      return result;
    });
  }

  /** Write the current state; rejects when the write fails. Runs only inside the queue. */
  private async writeState(): Promise<void> {
    if (!this.initialized) return;

    const exportedData = this.memory.exportData();

    const data: StorageData = {
      version: STORAGE_DATA_VERSION,
      exportedAt: Date.now(),
      sessions: exportedData.sessions,
      deviceFlows: exportedData.deviceFlows,
      authCodeFlows: exportedData.authCodeFlows,
      authCodes: exportedData.authCodes,
      mcpSessionMappings: exportedData.mcpSessionMappings,
      clients: exportedData.clients,
    };

    // Atomic write: write to temp file, then rename. Both are flushed to disk, so a power
    // loss cannot bring back a spent code or a revoked session either. The store holds
    // account tokens: owner-only, whatever the umask. The mode applies only when the file
    // is created, so a temp file left by a crash is narrowed too.
    const tempPath = `${this.filePath}.tmp`;
    const file = await fs.promises.open(tempPath, 'w', 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(JSON.stringify(data), 'utf-8');
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.promises.rename(tempPath, this.filePath);
    await syncDirectory(path.dirname(this.filePath));
    logDebug('Saved sessions to file', {
      sessions: data.sessions.length,
      deviceFlows: data.deviceFlows.length,
      authCodes: data.authCodes.length,
    });
  }

  private scheduleSave(): void {
    // Mark as pending
    this.pendingSave = true;

    // Debounce: cancel previous scheduled save
    if (this.saveDebounceId) {
      clearTimeout(this.saveDebounceId);
    }

    // Schedule save after debounce delay
    this.saveDebounceId = setTimeout(() => {
      if (this.pendingSave) {
        this.pendingSave = false;
        this.saveToFile().catch((err) => logError('Failed to save to file', { err }));
      }
    }, this.saveDebounce);
  }

  private startSaveInterval(): void {
    this.saveIntervalId = setInterval(() => {
      this.saveToFile().catch((err) => logError('Failed to save to file', { err }));
    }, this.saveInterval);

    if (this.saveIntervalId.unref) {
      this.saveIntervalId.unref();
    }
  }

  // Records handed to a client or to GitLab right after they are stored (client ids,
  // codes and their sessions, flows GitLab calls back for, device flows holding tokens
  // GitLab issued once) are written through, so a crash cannot lose what was handed out.
  // Cleanup and MCP transport mappings stay debounced.
  async createSession(session: OAuthSession): Promise<void> {
    await this.memory.createSession(session);
    await this.persistNow();
  }

  async getSession(sessionId: string): Promise<OAuthSession | undefined> {
    return this.memory.getSession(sessionId);
  }

  async getSessionByToken(token: string): Promise<OAuthSession | undefined> {
    return this.memory.getSessionByToken(token);
  }

  async getSessionByRefreshToken(refreshToken: string): Promise<OAuthSession | undefined> {
    return this.memory.getSessionByRefreshToken(refreshToken);
  }

  async updateSession(sessionId: string, updates: Partial<OAuthSession>): Promise<boolean> {
    const result = await this.memory.updateSession(sessionId, updates);
    // Written through: updates carry tokens just handed to clients or replacing spent
    // GitLab refresh tokens, which a crash must not lose.
    if (result) await this.persistNow();
    return result;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await this.memory.deleteSession(sessionId);
    // A revoked session must not come back after a crash.
    if (result) await this.persistNow();
    return result;
  }

  async getAllSessions(): Promise<OAuthSession[]> {
    return this.memory.getAllSessions();
  }

  // Device flow operations
  async storeDeviceFlow(state: string, flow: DeviceFlowState): Promise<void> {
    await this.memory.storeDeviceFlow(state, flow);
    await this.persistNow();
  }

  async getDeviceFlow(state: string): Promise<DeviceFlowState | undefined> {
    return this.memory.getDeviceFlow(state);
  }

  async getDeviceFlowByDeviceCode(deviceCode: string): Promise<DeviceFlowState | undefined> {
    return this.memory.getDeviceFlowByDeviceCode(deviceCode);
  }

  async deleteDeviceFlow(state: string): Promise<boolean> {
    const result = await this.memory.deleteDeviceFlow(state);
    if (result) this.scheduleSave();
    return result;
  }

  // Auth code flow operations
  async storeAuthCodeFlow(internalState: string, flow: AuthCodeFlowState): Promise<void> {
    await this.memory.storeAuthCodeFlow(internalState, flow);
    await this.persistNow();
  }

  async getAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined> {
    return this.memory.getAuthCodeFlow(internalState);
  }

  async deleteAuthCodeFlow(internalState: string): Promise<boolean> {
    const result = await this.memory.deleteAuthCodeFlow(internalState);
    if (result) this.scheduleSave();
    return result;
  }

  // Authorization code operations
  async storeAuthCode(code: AuthorizationCode): Promise<void> {
    await this.memory.storeAuthCode(code);
    await this.persistNow();
  }

  async getAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    return this.memory.getAuthCode(code);
  }

  async deleteAuthCode(code: string): Promise<boolean> {
    const result = await this.memory.deleteAuthCode(code);
    if (result) this.scheduleSave();
    return result;
  }

  // MCP session mapping
  async associateMcpSession(mcpSessionId: string, oauthSessionId: string): Promise<void> {
    await this.memory.associateMcpSession(mcpSessionId, oauthSessionId);
    this.scheduleSave();
  }

  async getSessionByMcpSessionId(mcpSessionId: string): Promise<OAuthSession | undefined> {
    return this.memory.getSessionByMcpSessionId(mcpSessionId);
  }

  async removeMcpSessionAssociation(mcpSessionId: string): Promise<boolean> {
    const result = await this.memory.removeMcpSessionAssociation(mcpSessionId);
    if (result) this.scheduleSave();
    return result;
  }

  // Registered OAuth clients
  async storeClient(client: RegisteredOAuthClient): Promise<void> {
    await this.memory.storeClient(client);
    await this.persistNow();
  }

  async getClient(clientId: string): Promise<RegisteredOAuthClient | undefined> {
    return this.memory.getClient(clientId);
  }

  async markClientUsed(clientId: string): Promise<void> {
    await this.memory.markClientUsed(clientId);
    await this.persistNow();
  }

  async countClientsRegisteredSince(registeredFrom: string, since: number): Promise<number> {
    return this.memory.countClientsRegisteredSince(registeredFrom, since);
  }

  // Single-use consumption and refresh rotation: written through before they are
  // reported, so a crash cannot make a spent code, flow or refresh token usable again.
  consumeAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    return this.transition(
      () => this.memory.consumeAuthCode(code),
      isPresent,
      (record) => this.memory.storeAuthCode(record),
    );
  }

  consumeAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined> {
    return this.transition(
      () => this.memory.consumeAuthCodeFlow(internalState),
      isPresent,
      (record) => this.memory.storeAuthCodeFlow(internalState, record),
    );
  }

  consumeDeviceFlow(state: string): Promise<DeviceFlowState | undefined> {
    return this.transition(
      () => this.memory.consumeDeviceFlow(state),
      isPresent,
      (record) => this.memory.storeDeviceFlow(state, record),
    );
  }

  async claimDevicePoll(
    state: string,
    now: number,
    nextPollAt: number,
  ): Promise<DeviceFlowState | undefined> {
    const claimed = await this.memory.claimDevicePoll(state, now, nextPollAt);
    if (claimed) this.scheduleSave();
    return claimed;
  }

  // GitLab refresh leases only coordinate requests of this process (the file backend has
  // one writer) and are not persisted.
  async claimGitLabRefresh(
    sessionId: string,
    expectedRefreshToken: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean> {
    return this.memory.claimGitLabRefresh(sessionId, expectedRefreshToken, now, leaseUntil);
  }

  async releaseGitLabRefresh(sessionId: string, leaseUntil: number): Promise<void> {
    await this.memory.releaseGitLabRefresh(sessionId, leaseUntil);
  }

  async rotateSession(
    sessionId: string,
    expectedRefreshToken: string,
    updates: Partial<OAuthSession>,
  ): Promise<boolean> {
    const previous: Partial<OAuthSession> = {};
    return this.transition(
      async () => {
        // The stored session is updated in place: copy the fields the rotation replaces.
        const current = await this.memory.getSession(sessionId);
        for (const key of Object.keys(updates) as Array<keyof OAuthSession>) {
          Object.assign(previous, { [key]: current?.[key] });
        }
        return this.memory.rotateSession(sessionId, expectedRefreshToken, updates);
      },
      (rotated): rotated is true => rotated,
      () => this.memory.updateSession(sessionId, previous),
    );
  }

  // Cleanup
  async cleanup(): Promise<void> {
    await this.memory.cleanup();
    await this.saveToFile();
  }

  async close(): Promise<void> {
    // Stop intervals
    if (this.saveIntervalId) {
      clearInterval(this.saveIntervalId);
      this.saveIntervalId = null;
    }
    if (this.saveDebounceId) {
      clearTimeout(this.saveDebounceId);
      this.saveDebounceId = null;
    }

    // Final save
    await this.saveToFile();

    // Close memory backend
    await this.memory.close();

    logInfo('File storage backend closed');
  }

  async getStats(): Promise<SessionStorageStats> {
    return this.memory.getStats();
  }

  /** Force immediate save (for graceful shutdown) */
  async forceSave(): Promise<void> {
    if (this.saveDebounceId) {
      clearTimeout(this.saveDebounceId);
      this.saveDebounceId = null;
    }
    this.pendingSave = false;
    await this.saveToFile();
  }
}
