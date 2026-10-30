import { join } from 'node:path';
import type { FSWatcher } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { ResultSchema, type ClientCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ConnectionAuthorization } from './authorization';
import {
  ConnectionInput,
  ConnectionStore,
  InvalidSavedConnection,
  type Connection,
  type ConnectionSnapshot,
} from './connection-store';

export interface Backend {
  client: Client;
  transport: Transport;
  snapshot: ConnectionSnapshot;
  authorization?: ConnectionAuthorization;
  identity?: unknown;
  stage?: 'initialization' | 'tool discovery' | 'account verification';
}

function connectionFailure(error: unknown, stage: Backend['stage']): string {
  const text =
    error instanceof Error
      ? `${error.message} ${String((error as Error & { cause?: { code?: string } }).cause?.code ?? '')}`
      : '';
  let reason = 'Check the address, credentials and server availability.';
  if (/401|unauthorized|authentication/i.test(text))
    reason = 'Authentication was rejected. Check the token or reconnect to sign in.';
  else if (/403|forbidden|scope/i.test(text))
    reason = 'The account lacks permission. Check its GitLab token scopes.';
  else if (/ENOTFOUND|EAI_AGAIN/i.test(text))
    reason = 'The address could not be resolved. Check the hostname and network.';
  else if (/certificate|CERT_|TLS|SSL/i.test(text))
    reason =
      'The TLS certificate could not be verified. Check the certificate chain and configured CA.';
  else if (/ECONNREFUSED|ECONNRESET|unreachable|timed out|timeout/i.test(text))
    reason = 'The server is unreachable or did not answer. Check the address and network.';
  return `Connection failed during ${stage ?? 'setup'}. ${reason} The previous connection is unchanged.`;
}

function localTransport(
  connection: Extract<Connection, { mode: 'local' }>,
  core: string,
): Transport {
  // A fresh process never inherits another server's policy or credentials.
  const env: Record<string, string> = {
    GITLAB_API_URL: connection.url,
    GITLAB_TOKEN: connection.token,
    LOG_JSON: 'true',
  };
  if (connection.initTimeoutMs !== undefined)
    env.GITLAB_INIT_TIMEOUT_MS = String(connection.initTimeoutMs);
  for (const name of [
    'HOME',
    'USERPROFILE',
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
    'LANG',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
    'GITLAB_CA_CERT_PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return new StdioClientTransport({
    command: process.execPath,
    args: [core, 'stdio'],
    env,
    cwd: join(core, '..', '..', '..'),
    stderr: 'ignore',
  });
}

/** The previous backend remains selected until a replacement has passed discovery and identity. */
export class Connections {
  active?: Backend;
  private pending?: Backend;
  private epoch = 0;
  private opening?: Promise<void>;
  private restoring?: Backend;
  private failedSnapshot?: ConnectionSnapshot;
  private readonly watcher: FSWatcher;
  private closing = false;
  private phase: 'unconfigured' | 'connecting' | 'connected' | 'failed' = 'unconfigured';
  private message?: { revision: number | null; text: string };
  private identity?: unknown;
  capabilities: ClientCapabilities = {};
  wire: (backend: Backend) => void = () => {};
  changed: () => void = () => {};

  constructor(
    readonly store: ConnectionStore,
    private readonly core = join(__dirname, 'core.js'),
  ) {
    this.watcher = store.watchChanges(() => {
      if (this.closing) return;
      void this.refresh().catch(() => {
        this.phase = 'failed';
        this.message = {
          revision: null,
          text: 'Could not read the saved connection. Reopen connection settings.',
        };
        this.changed();
      });
    });
  }

  private async refresh(): Promise<void> {
    const revision = this.store.revision();
    if (this.pending && this.pending.snapshot.revision !== revision) await this.cancel();
    if (this.closing) return;
    await this.ready();
  }

  status(): Record<string, unknown> {
    const saved = this.selection();
    const active = this.active?.snapshot.revision === saved.revision;
    const message =
      this.phase !== 'connecting' &&
      (this.message?.revision === null || this.message?.revision === saved.revision)
        ? this.message.text
        : undefined;
    let state = this.phase;
    if (state === 'failed' && !message) {
      if (active) state = 'connected';
      else if (saved.connection) state = 'connecting';
      else state = 'unconfigured';
    }
    return {
      revision: saved.revision,
      state: saved.error ? 'failed' : state,
      mode: saved.connection?.mode ?? null,
      url: saved.connection?.url ?? null,
      authentication: saved.connection?.mode === 'remote' ? saved.connection.authentication : null,
      initTimeoutMs:
        saved.connection?.mode === 'local' ? (saved.connection.initTimeoutMs ?? null) : null,
      identity: !saved.error && active ? (this.identity ?? null) : null,
      message: saved.error ?? message ?? null,
      authorizationUrl: this.pending?.authorization?.authorizationUrl ?? null,
      proposedTarget: this.pending
        ? {
            mode: this.pending.snapshot.connection?.mode,
            url: this.pending.snapshot.connection?.url,
          }
        : null,
    };
  }

  private failed(saved: ConnectionSnapshot): boolean {
    return (
      this.failedSnapshot?.revision === saved.revision &&
      JSON.stringify(this.failedSnapshot.connection) === JSON.stringify(saved.connection)
    );
  }

  private selection(): ConnectionSnapshot & { error?: string } {
    try {
      return this.store.read();
    } catch (error) {
      if (!(error instanceof InvalidSavedConnection)) throw error;
      return { revision: error.revision, connection: null, error: error.message };
    }
  }

  async ready(): Promise<Backend | undefined> {
    if (this.closing) return undefined;
    const saved = this.selection();
    if (saved.error) {
      if (this.failedSnapshot?.revision !== saved.revision || this.active) {
        await this.dispose(this.active);
        this.active = undefined;
        this.identity = undefined;
        this.phase = 'failed';
        this.message = { revision: saved.revision, text: saved.error };
        this.failedSnapshot = saved;
        this.changed();
      }
      return undefined;
    }
    if (!saved.connection && !this.active) return undefined;
    if (this.active?.snapshot.revision === saved.revision) {
      if (this.active.authorization && saved.connection?.authorization)
        this.active.authorization.data = saved.connection.authorization;
      this.active.snapshot = saved;
      return this.active;
    }
    if (this.failed(saved)) return undefined;
    this.opening ??= this.restore(saved).finally(() => {
      this.opening = undefined;
    });
    await this.opening;
    if (this.closing) return undefined;
    const current = this.selection();
    if (
      this.active?.snapshot.revision !== current.revision &&
      !this.failed(current) &&
      current.connection
    )
      return this.ready();
    return this.active;
  }

  private async restore(saved: ConnectionSnapshot): Promise<void> {
    const epoch = this.epoch;
    const previous = this.active;
    await this.dispose(previous);
    if (this.closing || epoch !== this.epoch || this.active !== previous) return;
    this.active = undefined;
    this.identity = undefined;
    if (!saved.connection) {
      this.phase = 'unconfigured';
      this.changed();
      return;
    }
    let backend: Backend | undefined;
    try {
      backend = await this.make(saved, false);
      this.restoring = backend;
      if (this.closing || epoch !== this.epoch) {
        await this.dispose(backend);
        return;
      }
      await this.qualify(backend);
      if (epoch !== this.epoch || this.store.read().revision !== backend.snapshot.revision) {
        await this.dispose(backend);
        return;
      }
      this.active = backend;
      this.identity = backend.identity;
      this.phase = 'connected';
      this.message = undefined;
    } catch (error) {
      await this.dispose(backend);
      if (epoch !== this.epoch || this.closing) return;
      this.phase = 'failed';
      const current = this.selection();
      this.failedSnapshot = current.revision === saved.revision ? current : saved;
      this.message = { revision: saved.revision, text: connectionFailure(error, backend?.stage) };
    } finally {
      if (this.restoring === backend) this.restoring = undefined;
    }
    this.changed();
  }

  async connect(input: unknown, expected: number): Promise<Record<string, unknown>> {
    const connection = ConnectionInput.parse(input);
    if (connection.mode === 'remote' && connection.authentication === 'bearer' && !connection.token)
      throw new Error('Enter the bearer token.');
    if (this.store.revision() !== expected)
      throw new Error('The connection changed. Open settings again.');
    const epoch = ++this.epoch;
    const pending = this.pending;
    this.pending = undefined;
    await this.dispose(pending);
    this.phase = 'connecting';
    let backend: Backend | undefined;
    try {
      backend = await this.make({ revision: expected, connection }, true);
      if (epoch !== this.epoch) {
        await this.dispose(backend);
        return this.status();
      }
      this.pending = backend;
      await this.qualify(backend);
      await this.accept(backend, epoch);
    } catch (error) {
      if (error instanceof UnauthorizedError && backend?.authorization?.authorizationUrl)
        return this.status();
      await this.dispose(backend);
      if (epoch === this.epoch) {
        this.pending = undefined;
        this.phase = 'failed';
        this.message = { revision: expected, text: connectionFailure(error, backend?.stage) };
      }
    }
    return this.status();
  }

  private authorization(
    connection: Extract<Connection, { mode: 'remote' }>,
    interactive: boolean,
    getBackend: () => Backend,
  ): ConnectionAuthorization {
    const data = interactive ? { redirectUrl: '' } : connection.authorization;
    if (!data) throw new Error('Reconnect to sign in.');
    const selected = (): boolean => !interactive || this.active === getBackend();
    const authorization = new ConnectionAuthorization(
      data,
      (patch) => {
        connection.authorization = authorization.data;
        if (!selected()) return;
        const backend = getBackend();
        const committed = this.store.updateAuthorization(backend.snapshot.revision, patch);
        backend.snapshot.connection = { ...connection, authorization: committed };
        return committed;
      },
      {
        current: () => {
          if (!selected()) return undefined;
          return this.store.readAuthorization(getBackend().snapshot.revision);
        },
        lockPath: this.store.refreshLockPath,
      },
    );
    connection.authorization = data;
    authorization.onFailure = () => {
      if (this.pending !== getBackend()) return;
      const failedEpoch = this.epoch + 1;
      void this.cancel().then(() => {
        if (this.epoch !== failedEpoch || this.closing) return;
        this.phase = 'failed';
        this.message = {
          revision: getBackend().snapshot.revision,
          text: 'Sign-in was cancelled, denied or expired. Try again.',
        };
        this.changed();
      });
    };
    return authorization;
  }

  private async make(snapshot: ConnectionSnapshot, interactive: boolean): Promise<Backend> {
    const connection = snapshot.connection;
    if (!connection) throw new Error('No connection is selected.');
    const client = new Client(
      { name: 'gitlab-mcp-plugin', version: '1.0.0' },
      { capabilities: this.capabilities },
    );
    let backend: Backend;
    let transport: Transport;
    let provider: ConnectionAuthorization | undefined;
    if (connection.mode === 'local') {
      transport = localTransport(connection, this.core);
    } else {
      if (connection.authentication === 'oauth')
        provider = this.authorization(connection, interactive, () => backend);
      transport = new StreamableHTTPClientTransport(new URL(connection.url), {
        authProvider: provider,
        fetch: provider?.fetch,
        ...(connection.authentication === 'bearer'
          ? { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } }
          : {}),
      });
    }
    backend = { client, snapshot, transport, authorization: provider };
    try {
      this.wire(backend);
      this.wireAuthorization(backend, connection.url);
      if (interactive && provider) await provider.listen();
      return backend;
    } catch (error) {
      await this.dispose(backend);
      throw error;
    }
  }

  private wireAuthorization(backend: Backend, url: string): void {
    if (!backend.authorization) return;
    backend.authorization.onCode = async (code) => {
      if (this.pending !== backend) return;
      const epoch = this.epoch;
      try {
        await (backend.transport as StreamableHTTPClientTransport).finishAuth(code);
        // SDK transports are single-use: failed initialization closes the first transport.
        backend.transport = new StreamableHTTPClientTransport(new URL(url), {
          authProvider: backend.authorization,
          fetch: backend.authorization?.fetch,
        });
        await this.qualify(backend);
        await this.accept(backend, epoch);
      } catch {
        backend.authorization?.onFailure?.();
      }
    };
  }

  private async qualify(backend: Backend): Promise<void> {
    // One SDK request budget covers the whole handshake, including arbitrarily paginated discovery.
    const signal = AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MSEC);
    backend.stage = 'initialization';
    await backend.client.connect(backend.transport, { signal });
    backend.stage = 'tool discovery';
    let cursor: string | undefined;
    for (;;) {
      const page = await backend.client.listTools({ cursor }, { signal });
      if (page.tools.some((tool) => tool.name === 'get_profile')) break;
      // MCP pagination ends only when nextCursor is absent; cursors are opaque strings.
      // https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination
      if (page.nextCursor === undefined)
        throw new Error('This endpoint is not a supported GitLab MCP server.');
      cursor = page.nextCursor;
    }
    backend.stage = 'account verification';
    const profile = await backend.client.request(
      { method: 'tools/call', params: { name: 'get_profile', arguments: {} } },
      ResultSchema,
      { signal },
    );
    if (profile.isError) {
      if (JSON.stringify(profile).includes('CONNECTION_FAILED'))
        throw new Error('Backend initialization failed or timed out.');
      const challenge = JSON.stringify(profile._meta?.['mcp/www_authenticate']);
      if (challenge?.includes('invalid_token'))
        throw new Error('GitLab authentication was rejected.');
      if (challenge?.includes('insufficient_scope'))
        throw new Error('GitLab token scope is insufficient.');
      throw new Error('The backend could not verify the GitLab account.');
    }
    const identity = profile.structuredContent;
    if (
      typeof identity !== 'object' ||
      identity === null ||
      !('id' in identity) ||
      typeof identity.id !== 'string' ||
      identity.id.length === 0
    )
      throw new Error('The server did not identify the connected account.');
    backend.identity = identity;
  }

  private async accept(backend: Backend, epoch: number): Promise<void> {
    if (this.pending !== backend || epoch !== this.epoch) {
      await this.dispose(backend);
      return;
    }
    backend.snapshot = this.store.commit(backend.snapshot.revision, backend.snapshot.connection);
    const previous = this.active;
    this.active = backend;
    this.identity = backend.identity;
    this.failedSnapshot = undefined;
    this.pending = undefined;
    backend.authorization?.close();
    this.phase = 'connected';
    this.message = undefined;
    this.changed();
    await this.dispose(previous);
  }

  async cancel(): Promise<void> {
    this.epoch++;
    const pending = this.pending;
    this.pending = undefined;
    await this.dispose(pending);
    const saved = this.selection();
    if (this.active?.snapshot.revision === saved.revision) this.phase = 'connected';
    else if (this.failed(saved)) this.phase = 'failed';
    else this.phase = saved.connection ? 'connecting' : 'unconfigured';
    if (this.phase !== 'failed') this.message = undefined;
  }

  async disconnect(expected: number): Promise<void> {
    this.store.commit(expected, null);
    await this.cancel();
    const active = this.active;
    this.active = undefined;
    this.identity = undefined;
    this.phase = 'unconfigured';
    this.message = undefined;
    this.changed();
    await this.dispose(active);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.watcher.close();
    await this.cancel();
    await this.dispose(this.restoring);
    await this.opening;
    await this.dispose(this.active);
    this.active = undefined;
    this.store.close();
  }

  private async dispose(backend: Backend | undefined): Promise<void> {
    await backend?.authorization?.dispose();
    if (backend) await backend.client.close();
  }
}
