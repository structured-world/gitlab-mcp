/**
 * Session Storage Types
 *
 * Interfaces for pluggable session storage backends.
 * Supports in-memory, file-based, and database storage.
 */

import {
  OAuthSession,
  DeviceFlowState,
  AuthCodeFlowState,
  AuthorizationCode,
  RegisteredOAuthClient,
} from '../types';
import type { AccountSettings, AccountSettingsRecord } from '../../configuration/types';

/** How long a session lives from its creation; cleanup removes it after that. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether a session (not a linked account, which goes with it) is past its age limit. */
export function isPastAgeLimit(session: OAuthSession, now = Date.now()): boolean {
  return session.createdAt + SESSION_MAX_AGE_MS < now;
}

/**
 * Ends the GitLab grant of an auth code flow removed unfinished. Rejects when the grant
 * could not be ended; the backend then keeps the flow, its only copy, for the next cleanup.
 */
export type AbandonedFlowGrantHandler = (flow: AuthCodeFlowState) => Promise<void>;

/** Removes a session that reached its age limit with its linked accounts, ending their grants. */
export type ExpiredSessionHandler = (session: OAuthSession) => Promise<void>;

/**
 * Session storage backend interface
 *
 * All storage backends must implement this interface for session persistence.
 * Operations are async to support network-based storage (PostgreSQL, Redis).
 *
 * Methods returning a boolean report a missing record as `false`. A failed read or
 * write rejects instead, so callers never mistake a storage outage for an absent record.
 */
export interface SessionStorageBackend {
  /** Backend type identifier */
  readonly type: 'memory' | 'file' | 'postgresql' | 'redis';

  // Session operations
  /** Store a new session; rejects when a session with its id exists. */
  createSession(session: OAuthSession): Promise<void>;
  getSession(sessionId: string): Promise<OAuthSession | undefined>;
  getSessionByToken(token: string): Promise<OAuthSession | undefined>;
  getSessionByRefreshToken(refreshToken: string): Promise<OAuthSession | undefined>;
  updateSession(sessionId: string, updates: Partial<OAuthSession>): Promise<boolean>;
  /** Delete a session together with the accounts linked to it. */
  deleteSession(sessionId: string): Promise<boolean>;
  getAllSessions(): Promise<OAuthSession[]>;
  /** The GitLab accounts linked to a session, oldest first. */
  getLinkedSessions(sessionId: string): Promise<OAuthSession[]>;

  // Device flow operations
  storeDeviceFlow(state: string, flow: DeviceFlowState): Promise<void>;
  getDeviceFlow(state: string): Promise<DeviceFlowState | undefined>;
  getDeviceFlowByDeviceCode(deviceCode: string): Promise<DeviceFlowState | undefined>;
  deleteDeviceFlow(state: string): Promise<boolean>;

  // Auth code flow operations
  storeAuthCodeFlow(internalState: string, flow: AuthCodeFlowState): Promise<void>;
  getAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined>;
  deleteAuthCodeFlow(internalState: string): Promise<boolean>;

  // Authorization code operations
  storeAuthCode(code: AuthorizationCode): Promise<void>;
  getAuthCode(code: string): Promise<AuthorizationCode | undefined>;
  deleteAuthCode(code: string): Promise<boolean>;

  // MCP session mapping
  associateMcpSession(mcpSessionId: string, oauthSessionId: string): Promise<void>;
  getSessionByMcpSessionId(mcpSessionId: string): Promise<OAuthSession | undefined>;
  removeMcpSessionAssociation(mcpSessionId: string): Promise<boolean>;

  // Registered OAuth clients (RFC 7591), shared by every replica
  storeClient(client: RegisteredOAuthClient): Promise<void>;
  getClient(clientId: string): Promise<RegisteredOAuthClient | undefined>;
  /** Record that the client completed an authorization: its registration no longer expires. */
  markClientUsed(clientId: string): Promise<void>;
  /** How many clients `registeredFrom` registered at or after `since` (epoch ms), used or not. */
  countClientsRegisteredSince(registeredFrom: string, since: number): Promise<number>;

  // Single-use consumption: of concurrent callers on any replica, exactly one receives
  // the record and the record is gone afterwards.
  consumeAuthCode(code: string): Promise<AuthorizationCode | undefined>;
  consumeAuthCodeFlow(internalState: string): Promise<AuthCodeFlowState | undefined>;
  consumeDeviceFlow(state: string): Promise<DeviceFlowState | undefined>;

  /**
   * Reserve the next GitLab poll of a device flow: when the flow exists and its
   * `nextPollAt` is unset or not after `now`, set it to `nextPollAt` and return the flow;
   * otherwise undefined. Of concurrent pollers on any replica, one wins each interval.
   */
  claimDevicePoll(
    state: string,
    now: number,
    nextPollAt: number,
  ): Promise<DeviceFlowState | undefined>;

  /**
   * Lease the session's GitLab refresh token for a refresh: succeeds only while the session
   * still holds `expectedRefreshToken` and no other unexpired lease exists, and then holds
   * the lease until `leaseUntil`. GitLab refresh tokens work once, so of concurrent
   * refreshes on any replica only the lease holder may spend the token.
   */
  claimGitLabRefresh(
    sessionId: string,
    expectedRefreshToken: string,
    now: number,
    leaseUntil: number,
  ): Promise<boolean>;

  /**
   * End the caller's GitLab refresh lease (after the refresh finished or failed), named by
   * the `leaseUntil` it claimed. A lease claimed later by another caller is kept: a lease
   * can only be claimed again after it expired, so a newer one always ends later.
   */
  releaseGitLabRefresh(sessionId: string, leaseUntil: number): Promise<void>;

  /**
   * Apply `updates` only while the session still holds `expectedRefreshToken`
   * (compare-and-set), so of concurrent refreshes exactly one rotates the tokens.
   */
  rotateSession(
    sessionId: string,
    expectedRefreshToken: string,
    updates: Partial<OAuthSession>,
  ): Promise<boolean>;

  // Account settings, shared by every replica
  getAccountSettings(accountKey: string): Promise<AccountSettingsRecord | undefined>;
  /**
   * Store an account's settings only while its stored version is still `expectedVersion`
   * (0: none stored yet). Returns the stored record, or undefined when another write
   * changed the settings first, so a stale edit never overwrites a newer one.
   */
  putAccountSettings(
    accountKey: string,
    settings: AccountSettings,
    expectedVersion: number,
  ): Promise<AccountSettingsRecord | undefined>;

  // Lifecycle
  initialize(): Promise<void>;
  /** Remove expired sessions, flows, codes and expired never-used client registrations. */
  cleanup(): Promise<void>;
  /**
   * Call `handler` for each expired auth code flow that holds GitLab tokens, taken out of
   * its callback's reach: the callback exchanged the code but never finished, so the flow
   * holds the only copy of that grant. The flow is removed once the handler resolves and
   * kept for the next cleanup when it rejects. Absent in database packages older than this
   * server.
   */
  onAbandonedFlowGrant?(handler: AbandonedFlowGrantHandler): void;
  /**
   * Hand each session cleanup expires (not an account linked to a session still stored) to
   * `handler`, which removes it with its linked accounts and ends their GitLab grants;
   * cleanup deletes whatever the handler left. Absent in database packages older than this
   * server.
   */
  onExpiredSession?(handler: ExpiredSessionHandler): void;
  close(): Promise<void>;

  // Statistics
  getStats(): Promise<SessionStorageStats>;
}

/**
 * Storage statistics
 */
export interface SessionStorageStats {
  sessions: number;
  deviceFlows: number;
  authCodeFlows: number;
  authCodes: number;
  mcpSessionMappings?: number;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Storage type: "memory", "file", "postgresql" */
  type: 'memory' | 'file' | 'postgresql';

  /** File storage options */
  file?: {
    /** Path to storage file */
    path: string;
    /** Auto-save interval in milliseconds (default: 30000) */
    saveInterval?: number;
  };

  /** PostgreSQL storage options */
  postgresql?: {
    /** Connection string */
    connectionString: string;
    /** Table name prefix (default: "oauth_") */
    tablePrefix?: string;
    /** Enable SSL (default: true for production) */
    ssl?: boolean;
  };
}

/**
 * Data export format for file storage
 */
export interface StorageData {
  version: number;
  exportedAt: number;
  sessions: OAuthSession[];
  deviceFlows: Array<{ state: string; flow: DeviceFlowState }>;
  authCodeFlows: Array<{ internalState: string; flow: AuthCodeFlowState }>;
  authCodes: AuthorizationCode[];
  mcpSessionMappings: Array<{ mcpSessionId: string; oauthSessionId: string }>;
  /** Registered OAuth clients; absent in files written before client persistence */
  clients?: RegisteredOAuthClient[];
  /** Account settings; absent in files written before settings persistence */
  accountSettings?: AccountSettingsRecord[];
}

/** Current storage data format version */
export const STORAGE_DATA_VERSION = 1;
