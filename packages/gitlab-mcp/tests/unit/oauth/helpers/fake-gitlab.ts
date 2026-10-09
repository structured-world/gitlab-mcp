/**
 * Minimal GitLab OAuth provider for HTTP-level tests.
 *
 * Implements the endpoints gitlab-mcp calls (token exchange, refresh with rotation,
 * device flow, revocation, /api/v4/user) with GitLab's error shapes, and records
 * every request so tests can assert which application and instance were used.
 */

import * as http from 'node:http';
import { AddressInfo } from 'node:net';

export interface FakeUser {
  id: number;
  username: string;
  name?: string;
  email?: string;
}

interface Grant {
  user: FakeUser;
  scope: string;
}

export interface FakeGitLabOptions {
  clientId: string;
  clientSecret?: string;
  /** Token lifetime GitLab reports (seconds) */
  expiresIn?: number;
}

export interface RecordedRequest {
  path: string;
  params: Record<string, string>;
  authorization?: string;
}

export class FakeGitLab {
  readonly requests: RecordedRequest[] = [];
  /** Next refresh_token grant fails with this HTTP status (500) or OAuth error */
  refreshFailure: 'server_error' | 'invalid_grant' | undefined;
  /** Device code -> undefined while pending, the user once approved */
  readonly devices = new Map<string, FakeUser | undefined>();
  deviceUserCode = 'WXYZ-1234';
  /** Number of upcoming /api/v4/user requests answered with a 502 */
  userFailures = 0;

  private server: http.Server | undefined;
  private readonly codes = new Map<string, { grant: Grant; redirectUri: string }>();
  private readonly accessTokens = new Map<string, Grant>();
  private readonly refreshTokens = new Map<string, Grant>();
  private counter = 0;

  constructor(private readonly options: FakeGitLabOptions) {}

  get url(): string {
    const address = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(String(error));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  /** A GitLab authorization code as if the user approved the consent screen. */
  approve(user: FakeUser, redirectUri: string, scope = 'api read_user'): string {
    const code = `gl-code-${++this.counter}`;
    this.codes.set(code, { grant: { user, scope }, redirectUri });
    return code;
  }

  /** Revoke every token of a user at GitLab (e.g. the user removed the application). */
  revokeUser(userId: number): void {
    for (const store of [this.accessTokens, this.refreshTokens]) {
      for (const [token, grant] of store) {
        if (grant.user.id === userId) store.delete(token);
      }
    }
  }

  /** Whether GitLab still accepts this access token. */
  accepts(accessToken: string): boolean {
    return this.accessTokens.has(accessToken);
  }

  private issue(grant: Grant): Record<string, unknown> {
    const n = ++this.counter;
    const access = `gl-at-${n}`;
    const refresh = `gl-rt-${n}`;
    this.accessTokens.set(access, grant);
    this.refreshTokens.set(refresh, grant);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: this.options.expiresIn ?? 7200,
      created_at: Math.floor(Date.now() / 1000),
      scope: grant.scope,
    };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const params = Object.fromEntries(new URLSearchParams(body));
    this.requests.push({ path: url.pathname, params, authorization: req.headers.authorization });

    const [status, value] = this.route(url.pathname, params, req.headers.authorization);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  }

  private route(path: string, params: Params, authorization: string | undefined): Reply {
    switch (path) {
      case '/api/v4/user':
        return this.currentUser(authorization);
      case '/oauth/authorize_device':
        return this.authorizeDevice(params);
      case '/oauth/revoke':
        this.refreshTokens.delete(params.token);
        this.accessTokens.delete(params.token);
        return [200, {}];
      case '/oauth/token':
        return this.token(params);
      default:
        return [404, { message: 'Not found' }];
    }
  }

  private currentUser(authorization: string | undefined): Reply {
    if (this.userFailures > 0) {
      this.userFailures--;
      return [502, { message: '502 Bad Gateway' }];
    }
    const grant = this.accessTokens.get(authorization?.replace(/^Bearer /, '') ?? '');
    return grant
      ? [200, { ...grant.user, state: 'active' }]
      : [401, { message: '401 Unauthorized' }];
  }

  private authorizeDevice(params: Params): Reply {
    if (params.client_id !== this.options.clientId) return [401, { error: 'invalid_client' }];
    const deviceCode = `device-${++this.counter}`;
    this.devices.set(deviceCode, undefined);
    return [
      200,
      {
        device_code: deviceCode,
        user_code: this.deviceUserCode,
        verification_uri: `${this.url}/oauth/device`,
        expires_in: 300,
        interval: 5,
      },
    ];
  }

  private token(params: Params): Reply {
    const clientOk =
      params.client_id === this.options.clientId &&
      params.client_secret === this.options.clientSecret;
    if (!clientOk) return [401, { error: 'invalid_client' }];
    switch (params.grant_type) {
      case 'authorization_code':
        return this.authorizationCodeGrant(params);
      case 'refresh_token':
        return this.refreshGrant(params);
      case 'urn:ietf:params:oauth:grant-type:device_code':
        return this.deviceGrant(params);
      default:
        return [400, { error: 'unsupported_grant_type' }];
    }
  }

  private authorizationCodeGrant(params: Params): Reply {
    const entry = this.codes.get(params.code);
    this.codes.delete(params.code);
    if (entry?.redirectUri !== params.redirect_uri) return [400, { error: 'invalid_grant' }];
    return [200, this.issue(entry.grant)];
  }

  private refreshGrant(params: Params): Reply {
    if (this.refreshFailure === 'server_error') return [500, { message: 'Internal Server Error' }];
    const grant = this.refreshTokens.get(params.refresh_token);
    // GitLab rotates refresh tokens: the presented one is spent either way.
    this.refreshTokens.delete(params.refresh_token);
    if (!grant || this.refreshFailure === 'invalid_grant') {
      return [
        400,
        {
          error: 'invalid_grant',
          error_description: 'The provided authorization grant is invalid',
        },
      ];
    }
    return [200, this.issue(grant)];
  }

  private deviceGrant(params: Params): Reply {
    if (!this.devices.has(params.device_code)) return [400, { error: 'expired_token' }];
    const user = this.devices.get(params.device_code);
    if (!user) return [400, { error: 'authorization_pending' }];
    this.devices.delete(params.device_code);
    return [200, this.issue({ user, scope: 'api read_user' })];
  }
}

type Params = Record<string, string>;
/** HTTP status and JSON body of a response */
type Reply = [status: number, body: unknown];
