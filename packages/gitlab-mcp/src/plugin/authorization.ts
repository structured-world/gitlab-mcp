import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { RemoteAuthorization } from './connection-store';
import { SavedOAuthTokens } from './connection-store';
import { OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { fetchWithinOrigin, type FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { RefreshGuard } from './refresh-guard';

interface SharedAuthorization {
  current(): RemoteAuthorization | undefined;
  lockPath: string;
}

/** SDK OAuth state belongs to one proposed or committed connection, never to a host name. */
export class ConnectionAuthorization implements OAuthClientProvider {
  private verifier?: string;
  private readonly nonce = randomBytes(32).toString('base64url');
  private callback?: Server;
  private timer?: NodeJS.Timeout;
  authorizationUrl?: string;
  onCode?: (code: string) => Promise<void>;
  onFailure?: () => void;
  interactive = false;
  private readonly abort = new AbortController();
  private readonly refreshLock: RefreshGuard;

  constructor(
    public data: RemoteAuthorization,
    private readonly save: (patch: Partial<RemoteAuthorization>) => RemoteAuthorization | void,
    private readonly shared: SharedAuthorization,
  ) {
    this.refreshLock = new RefreshGuard(shared.lockPath);
  }

  readonly fetch: FetchLike = async (url, init) => {
    const body = init?.body;
    const signal = init?.signal
      ? AbortSignal.any([init.signal, this.abort.signal])
      : this.abort.signal;
    const request = { ...init, signal };
    if (
      body instanceof URLSearchParams &&
      body.get('grant_type') === 'refresh_token' &&
      this.shared.current()
    ) {
      const previous = this.data.tokens;
      return this.refreshLock.run(() => this.refresh(url, request, body, previous));
    }
    return fetch(url, request);
  };

  private async refresh(
    url: string | URL,
    init: RequestInit,
    body: URLSearchParams,
    previous: OAuthTokens | undefined,
  ): Promise<Response> {
    const current = this.shared.current();
    if (!current) throw new Error('The OAuth connection is no longer selected.');
    this.data = current;
    const tokens = current.tokens;
    if (!tokens) throw new Error('Reconnect from connection settings.');
    if (
      tokens.refresh_token !== body.get('refresh_token') ||
      tokens.access_token !== previous?.access_token
    )
      return Response.json(tokens);
    const issuer = tokens.issuer;
    const response = await fetchWithinOrigin(fetch)(url, init);
    const value: unknown = await response.json();
    this.abort.signal.throwIfAborted();
    if (!response.ok) return this.refreshError(response.status, value);
    // RFC 6749 section 6 retains the old refresh token when the response omits a replacement.
    const refreshed = {
      refresh_token: tokens.refresh_token,
      ...OAuthTokensSchema.omit({ issuer: true }).parse(value),
      issuer,
    };
    this.persist({ tokens: refreshed });
    return Response.json(refreshed);
  }

  private refreshError(status: number, value: unknown): Response {
    const code =
      typeof value === 'object' && value !== null && 'error' in value ? value.error : undefined;
    if (code === 'invalid_grant') this.persist({ tokens: undefined });
    else if (code === 'invalid_client' || code === 'unauthorized_client')
      this.persist({ client: undefined, tokens: undefined, discovery: undefined });
    const recognized = [
      'invalid_grant',
      'invalid_client',
      'unauthorized_client',
      'invalid_request',
      'invalid_scope',
      'unsupported_grant_type',
      'server_error',
      'temporarily_unavailable',
    ];
    if (typeof code !== 'string' || !recognized.includes(code))
      throw new Error(`OAuth refresh failed (HTTP ${status}).`);
    return Response.json({ error: code }, { status });
  }

  get redirectUrl(): string {
    return this.data.redirectUrl;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'GitLab by Structured World',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  state(): string {
    return this.nonce;
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.data.client;
  }
  saveClientInformation(client: OAuthClientInformationMixed): void {
    this.persist({ client });
  }
  tokens(): OAuthTokens | undefined {
    return this.data.tokens;
  }
  saveTokens(tokens: OAuthTokens): void {
    // Committed refresh results are saved under the shared lock before the SDK receives them.
    const current = this.shared.current();
    if (current) {
      this.data = current;
      return;
    }
    this.persist({ tokens: SavedOAuthTokens.parse(tokens) });
  }
  saveDiscoveryState(discovery: OAuthDiscoveryState): void {
    this.persist({ discovery });
  }
  discoveryState(): OAuthDiscoveryState | undefined {
    return this.data.discovery;
  }
  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }
  codeVerifier(): string {
    if (!this.verifier) throw new Error('Sign-in expired. Reconnect from connection settings.');
    return this.verifier;
  }
  redirectToAuthorization(url: URL): void {
    if (!this.interactive) throw new Error('Reconnect from connection settings.');
    this.authorizationUrl = url.href;
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    const current = this.shared.current();
    if (current && (scope === 'all' || scope === 'tokens')) {
      this.data = current;
      if (scope === 'all') this.verifier = undefined;
      return;
    }
    const patch: Partial<RemoteAuthorization> = {};
    if (scope === 'all' || scope === 'client') patch.client = undefined;
    if (scope === 'all' || scope === 'tokens') patch.tokens = undefined;
    if (scope === 'all' || scope === 'discovery') patch.discovery = undefined;
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined;
    this.persist(patch);
  }

  private persist(patch: Partial<RemoteAuthorization>): void {
    this.data = { ...this.data, ...patch };
    const committed = this.save(patch);
    if (committed) this.data = committed;
  }

  async listen(): Promise<void> {
    const path = `/callback/${randomBytes(24).toString('base64url')}`;
    const callback = createServer((request, response) => {
      if (!request.url) {
        response.writeHead(400).end('Invalid authorization callback.');
        return;
      }
      const url = new URL(request.url, this.redirectUrl);
      if (
        request.method !== 'GET' ||
        url.pathname !== path ||
        url.searchParams.get('state') !== this.nonce
      ) {
        response.writeHead(400).end('Invalid authorization callback.');
        return;
      }
      const issuer = this.data.discovery?.authorizationServerUrl;
      if (url.searchParams.has('iss') && url.searchParams.get('iss') !== String(issuer)) {
        response.writeHead(400).end('Invalid authorization issuer.');
        return;
      }
      const code = url.searchParams.get('code');
      response
        .writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'",
        })
        .end('Return to GitLab connection settings.');
      this.stopListener();
      if (!code || url.searchParams.has('error')) {
        this.close();
        this.onFailure?.();
        return;
      }
      void this.onCode?.(code).catch(() => this.onFailure?.());
    });
    this.callback = callback;
    await new Promise<void>((resolve, reject) => {
      callback.once('error', reject);
      callback.listen(0, '127.0.0.1', resolve);
    });
    const address = callback.address();
    if (!address || typeof address === 'string') throw new Error('Cannot start sign-in callback.');
    this.data.redirectUrl = `http://127.0.0.1:${address.port}${path}`;
    this.interactive = true;
    this.timer = setTimeout(() => {
      this.close();
      this.onFailure?.();
    }, 5 * 60_000);
    this.timer.unref();
  }

  close(): void {
    this.stopListener();
    this.verifier = undefined;
    this.interactive = false;
  }

  async dispose(): Promise<void> {
    this.close();
    this.abort.abort();
    await this.refreshLock.close();
  }

  private stopListener(): void {
    if (this.timer) clearTimeout(this.timer);
    this.callback?.close();
    this.callback?.closeAllConnections();
    this.callback = undefined;
  }
}
