/**
 * OAuth handshake over real HTTP: production routes and middleware on express, a fake
 * GitLab, and several replicas that share only the storage backend.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeGitLab, type FakeUser } from './helpers/fake-gitlab';
import {
  GITLAB_APP_ID,
  ISSUER,
  oauthEnv,
  startReplica,
  type McpReplica,
} from './helpers/mcp-oauth-server';
import { MemoryStorageBackend } from '../../../src/oauth/storage/memory';
import { FileStorageBackend } from '../../../src/oauth/storage/file';
import type { SessionStorageBackend } from '../../../src/oauth/storage/types';

const CLIENT_REDIRECT = 'https://client.example.com/oauth/callback';
const CALLBACK = `${ISSUER}/oauth/callback`;
const jane: FakeUser = { id: 42, username: 'jane', name: 'Jane Doe' };

interface TokenSet {
  access_token: string;
  refresh_token: string;
  scope: string;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function register(replica: McpReplica): Promise<string> {
  const response = await fetch(`${replica.url}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [CLIENT_REDIRECT], client_name: 'Test client' }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString(),
  };
}

describe('OAuth handshake over HTTP', () => {
  let gitlab: FakeGitLab;
  let backend: SessionStorageBackend;
  let replicas: McpReplica[];
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    gitlab = new FakeGitLab({ clientId: GITLAB_APP_ID });
    await gitlab.start();
  });

  afterAll(async () => {
    await gitlab.stop();
  });

  beforeEach(() => {
    oauthEnv(gitlab.url);
    backend = new MemoryStorageBackend({ silent: true });
    replicas = [];
    gitlab.refreshFailure = undefined;
    gitlab.requests.length = 0;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(replicas.map((replica) => replica.close()));
    await backend.close();
    process.env = { ...savedEnv };
  });

  async function replica(shared: SessionStorageBackend = backend): Promise<McpReplica> {
    const started = await startReplica(shared);
    replicas.push(started);
    return started;
  }

  /** Browser part: /authorize on one replica, GitLab consent, /oauth/callback on another. */
  async function signIn(
    authorizeOn: McpReplica,
    callbackOn: McpReplica,
    clientId: string,
    challenge: string,
    extra: Record<string, string> = {},
  ): Promise<URL> {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CLIENT_REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'client-csrf',
      ...extra,
    });
    const toGitLab = await fetch(`${authorizeOn.url}/authorize?${query}`, { redirect: 'manual' });
    expect(toGitLab.status).toBe(302);
    const gitlabAuthorize = new URL(toGitLab.headers.get('location')!);
    expect(gitlabAuthorize.origin + gitlabAuthorize.pathname).toBe(`${gitlab.url}/oauth/authorize`);
    expect(gitlabAuthorize.searchParams.get('redirect_uri')).toBe(CALLBACK);

    const glCode = gitlab.approve(jane, CALLBACK);
    const back = await fetch(
      `${callbackOn.url}/oauth/callback?code=${glCode}&state=${gitlabAuthorize.searchParams.get('state')}`,
      { redirect: 'manual' },
    );
    expect(back.status).toBe(302);
    return new URL(back.headers.get('location')!);
  }

  async function exchange(
    on: McpReplica,
    clientId: string,
    code: string,
    verifier: string,
  ): Promise<Response> {
    return fetch(
      `${on.url}/token`,
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: CLIENT_REDIRECT,
      }),
    );
  }

  async function connect(
    on: McpReplica = replicas[0],
  ): Promise<{ clientId: string; tokens: TokenSet }> {
    const clientId = await register(on);
    const { verifier, challenge } = pkce();
    const redirect = await signIn(on, on, clientId, challenge);
    const response = await exchange(on, clientId, redirect.searchParams.get('code')!, verifier);
    expect(response.status).toBe(200);
    return { clientId, tokens: (await response.json()) as TokenSet };
  }

  async function callMcp(on: McpReplica, accessToken: string): Promise<Response> {
    return fetch(`${on.url}/mcp`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }

  it('discovers, registers, signs in and serves /mcp with the issued token', async () => {
    const mcp = await replica();

    const challenge401 = await fetch(`${mcp.url}/mcp`);
    expect(challenge401.status).toBe(401);
    expect(challenge401.headers.get('www-authenticate')).toBe(
      `Bearer realm="gitlab-mcp", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`,
    );
    const prm = (await (
      await fetch(`${mcp.url}/.well-known/oauth-protected-resource/mcp`)
    ).json()) as { resource: string; authorization_servers: string[] };
    expect(prm).toMatchObject({ resource: `${ISSUER}/mcp`, authorization_servers: [ISSUER] });
    const asm = (await (
      await fetch(`${mcp.url}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(asm).toMatchObject({
      issuer: ISSUER,
      authorization_response_iss_parameter_supported: true,
      revocation_endpoint: `${ISSUER}/revoke`,
    });

    const clientId = await register(mcp);
    const { verifier, challenge } = pkce();
    const redirect = await signIn(mcp, mcp, clientId, challenge, { resource: `${ISSUER}/mcp` });
    expect(redirect.origin + redirect.pathname).toBe(CLIENT_REDIRECT);
    expect(redirect.searchParams.get('state')).toBe('client-csrf');
    expect(redirect.searchParams.get('iss')).toBe(ISSUER);

    const token = await exchange(mcp, clientId, redirect.searchParams.get('code')!, verifier);
    expect(token.status).toBe(200);
    const tokens = (await token.json()) as TokenSet;
    expect(tokens.scope).toBe('mcp:tools mcp:resources');

    const served = await callMcp(mcp, tokens.access_token);
    expect(served.status).toBe(200);
    expect(await served.json()).toMatchObject({
      gitlabUserId: 42,
      gitlabUsername: 'jane',
      gitlabApiUrl: gitlab.url,
      mcpResource: `${ISSUER}/mcp`,
    });
  });

  // Tool dispatch checks the token's MCP scopes, so the request must carry them.
  it('passes the scopes of the presented token to the request', async () => {
    const mcp = await replica();
    const clientId = await register(mcp);
    const { verifier, challenge } = pkce();
    const redirect = await signIn(mcp, mcp, clientId, challenge, { scope: 'mcp:resources' });
    const token = await exchange(mcp, clientId, redirect.searchParams.get('code')!, verifier);
    const tokens = (await token.json()) as TokenSet;
    expect(tokens.scope).toBe('mcp:resources');

    const served = await callMcp(mcp, tokens.access_token);
    expect(served.status).toBe(200);
    expect(await served.json()).toMatchObject({ mcpScopes: ['mcp:resources'] });
  });

  it('serves every step of the sign-in from a different replica', async () => {
    const [a, b] = [await replica(), await replica()];

    const clientId = await register(a);
    const { verifier, challenge } = pkce();
    const redirect = await signIn(b, a, clientId, challenge);
    const token = await exchange(b, clientId, redirect.searchParams.get('code')!, verifier);
    expect(token.status).toBe(200);
    const { access_token } = (await token.json()) as TokenSet;

    expect((await callMcp(a, access_token)).status).toBe(200);
    expect((await callMcp(b, access_token)).status).toBe(200);
  });

  it('redeems an authorization code exactly once when two replicas race', async () => {
    const [a, b] = [await replica(), await replica()];
    const clientId = await register(a);
    const { verifier, challenge } = pkce();
    const code = (await signIn(a, a, clientId, challenge)).searchParams.get('code')!;

    const results = await Promise.all([
      exchange(a, clientId, code, verifier),
      exchange(b, clientId, code, verifier),
    ]);

    expect(results.map((response) => response.status).sort()).toEqual([200, 400]);
  });

  it('rotates a refresh token exactly once when two replicas race', async () => {
    const [a, b] = [await replica(), await replica()];
    const { clientId, tokens } = await connect(a);
    const refresh = (on: McpReplica, token: string) =>
      fetch(
        `${on.url}/token`,
        form({ grant_type: 'refresh_token', refresh_token: token, client_id: clientId }),
      );

    const results = await Promise.all([
      refresh(a, tokens.refresh_token),
      refresh(b, tokens.refresh_token),
    ]);

    expect(results.map((response) => response.status).sort()).toEqual([200, 400]);
    const winner = (await results.find((response) => response.status === 200)!.json()) as TokenSet;
    // The rotated token works on any replica; the spent one does not.
    expect((await refresh(b, winner.refresh_token)).status).toBe(200);
    expect((await refresh(a, tokens.refresh_token)).status).toBe(400);
  });

  it('keeps registrations and sessions across a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-restart-'));
    const filePath = path.join(dir, 'sessions.json');
    try {
      const before = new FileStorageBackend({ filePath });
      const first = await replica(before);
      const { clientId, tokens } = await connect(first);
      await first.close();
      replicas.splice(replicas.indexOf(first), 1);
      await before.close();

      const after = new FileStorageBackend({ filePath });
      const restarted = await replica(after);

      expect((await callMcp(restarted, tokens.access_token)).status).toBe(200);
      // The dynamic registration survived: authorization still accepts the client.
      const { challenge } = pkce();
      const redirect = await signIn(restarted, restarted, clientId, challenge);
      expect(redirect.searchParams.get('code')).toBeTruthy();
      await after.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown clients, unregistered redirects and foreign resources before GitLab', async () => {
    const mcp = await replica();
    const clientId = await register(mcp);
    const { challenge } = pkce();
    const authorize = (params: Record<string, string>) =>
      fetch(
        `${mcp.url}/authorize?${new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: CLIENT_REDIRECT,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 's',
          ...params,
        })}`,
        { redirect: 'manual' },
      );

    expect((await authorize({ client_id: 'unknown' })).status).toBe(400);
    expect((await authorize({ redirect_uri: 'https://attacker.example/cb' })).status).toBe(400);
    const foreign = await authorize({ resource: 'https://other.example.com/mcp' });
    expect(foreign.status).toBe(302);
    const location = new URL(foreign.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('invalid_target');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
    expect(gitlab.requests).toHaveLength(0);
  });

  it('rejects code reuse and a code presented by another client', async () => {
    const mcp = await replica();
    const clientId = await register(mcp);
    const other = await register(mcp);
    const { verifier, challenge } = pkce();
    const code = (await signIn(mcp, mcp, clientId, challenge)).searchParams.get('code')!;

    expect((await exchange(mcp, other, code, verifier)).status).toBe(400);
    // The failed attempt consumed the code: the rightful client cannot reuse it either.
    expect((await exchange(mcp, clientId, code, verifier)).status).toBe(400);
  });

  it('answers 503 instead of a bad-token 401 when storage fails', async () => {
    const failing = new MemoryStorageBackend({ silent: true });
    const mcp = await replica(failing);
    const { tokens } = await connect(mcp);
    jest.spyOn(failing, 'getSession').mockRejectedValue(new Error('database down'));

    const response = await callMcp(mcp, tokens.access_token);

    expect(response.status).toBe(503);
    expect(response.headers.get('www-authenticate')).toBeNull();
    await failing.close();
  });

  it('asks the client to reconnect when GitLab revoked the grant', async () => {
    const mcp = await replica();
    const { tokens } = await connect(mcp);
    const sessionId = (
      (await (await callMcp(mcp, tokens.access_token)).json()) as {
        oauthSessionId: string;
      }
    ).oauthSessionId;
    gitlab.revokeUser(jane.id);
    // The GitLab token is due for refresh, which GitLab now refuses.
    await backend.updateSession(sessionId, { gitlabTokenExpiry: Date.now() - 1000 });

    const response = await callMcp(mcp, tokens.access_token);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('disconnects on every replica when a token is revoked', async () => {
    const [a, b] = [await replica(), await replica()];
    const { clientId, tokens } = await connect(a);
    const glAccess = gitlab.requests.length;

    const revoked = await fetch(
      `${b.url}/revoke`,
      form({ token: tokens.refresh_token, client_id: clientId }),
    );

    expect(revoked.status).toBe(200);
    expect((await callMcp(a, tokens.access_token)).status).toBe(401);
    expect(
      gitlab.requests.slice(glAccess).some((request) => request.path === '/oauth/revoke'),
    ).toBe(true);
  });

  it('runs the device flow at the interval GitLab and the operator allow', async () => {
    const mcp = await replica();
    const { verifier, challenge } = pkce();
    const page = await fetch(
      `${mcp.url}/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: 'cli-client',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
    );
    const html = await page.text();
    expect(html).toContain('let pollInterval = 5000;');
    const flowState = /flow_state=([A-Za-z0-9_-]+)/.exec(html)![1];
    const poll = async () =>
      (await (await fetch(`${mcp.url}/oauth/poll?flow_state=${flowState}`)).json()) as {
        status: string;
        code?: string;
        interval?: number;
      };

    // Too early: answered without asking GitLab.
    const polls = () => gitlab.requests.filter((r) => r.params.grant_type?.includes('device_code'));
    expect(await poll()).toEqual({ status: 'pending', interval: 5 });
    expect(polls()).toHaveLength(0);

    const [deviceCode] = gitlab.devices.keys();
    gitlab.devices.set(deviceCode, jane);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 6000);

    const done = await poll();
    expect(done.status).toBe('complete');
    expect(polls()).toHaveLength(1);

    const token = await fetch(
      `${mcp.url}/token`,
      form({
        grant_type: 'authorization_code',
        code: done.code!,
        code_verifier: verifier,
        client_id: 'cli-client',
      }),
    );
    expect(token.status).toBe(200);
  });
});
