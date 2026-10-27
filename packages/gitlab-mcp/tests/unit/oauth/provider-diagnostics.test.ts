import { Writable } from 'node:stream';
import { inspect } from 'node:util';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { pino } from 'pino';
import {
  exchangeGitLabAuthCode,
  refreshGitLabToken,
  initiateDeviceFlow,
  getGitLabUser,
  revokeGitLabToken,
  pollDeviceFlowStep,
  GitLabOAuthHttpError,
} from '../../../src/oauth/gitlab-device-flow';
import { callbackHandler } from '../../../src/oauth/endpoints/callback';
import { sessionStore } from '../../../src/oauth/session-store';
import { oauthAppFor } from '../../../src/oauth/instance-app';
import { failAccountLink } from '../../../src/accounts/link';
import { logger } from '../../../src/logger';
import type { OAuthConfig } from '../../../src/oauth/config';
import type { Request, Response as ExpressResponse } from 'express';
import { installFetchMock, mockEnhancedFetch } from '../helpers/fetch-mock';

jest.mock('../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
jest.mock('../../../src/oauth/config', () => ({ loadOAuthConfig: () => config }));
jest.mock('../../../src/oauth/session-store', () => ({
  sessionStore: {
    getAuthCodeFlow: jest.fn(),
    consumeAuthCodeFlow: jest.fn(),
  },
}));
jest.mock('../../../src/oauth/instance-app', () => ({
  oauthAppFor: jest.fn(),
}));
jest.mock('../../../src/oauth/endpoints/authorize', () => ({ discardCompletion: jest.fn() }));
jest.mock('../../../src/accounts/link', () => ({
  completeAccountLink: jest.fn(),
  failAccountLink: jest.fn(),
}));

installFetchMock();

const config: OAuthConfig = {
  enabled: true,
  issuer: 'https://mcp.example.com',
  gitlabClientId: 'app',
  gitlabScopes: 'api',
  sessionSecret: 'test-session-secret-minimum-32-characters',
  tokenTtl: 3600,
  refreshTokenTtl: 604800,
  devicePollInterval: 5,
  deviceTimeout: 300,
};
const secret = 'synthetic-provider-secret-must-not-escape';
let output: string;

beforeEach(() => {
  jest.mocked(sessionStore.getAuthCodeFlow).mockResolvedValue({
    clientId: 'client',
    clientRedirectUri: 'https://client.example.com/callback',
    callbackUri: 'https://mcp.example.com/oauth/callback',
    internalState: 'state',
    clientState: 'client-state',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
    expiresAt: Date.now() + 60_000,
  });
  jest.mocked(oauthAppFor).mockResolvedValue({
    baseUrl: 'https://gitlab.example.com',
    clientId: 'app',
    scopes: 'api',
  });
  output = '';
  const capture = pino(
    {},
    new Writable({
      write(chunk, _encoding, done) {
        output += String(chunk);
        done();
      },
    }),
  );
  // Keep the real logging wrappers and pino serializers, redirecting only their destination.
  jest.spyOn(logger, 'error').mockImplementation(capture.error.bind(capture));
  jest.spyOn(logger, 'warn').mockImplementation(capture.warn.bind(capture));
});
afterEach(() => jest.restoreAllMocks());

const operations = {
  refresh: () => refreshGitLabToken('refresh', config),
  exchange: () => exchangeGitLabAuthCode('code', 'https://mcp.example.com/oauth/callback', config),
  device: () => initiateDeviceFlow(config),
  user: () => getGitLabUser('access', 'https://gitlab.example.com'),
  revoke: () => revokeGitLabToken('access', config),
};
const bodies = [
  JSON.stringify({ error: 'invalid_grant', error_description: secret }),
  JSON.stringify({ error: secret }),
  `<html>${secret}</html>`,
  secret,
  '',
  `{"error":"${secret}`,
  JSON.stringify({ error: { token: secret } }),
  JSON.stringify({ error: [secret] }),
  'null',
];

// Every shared-helper caller must omit provider content, including unknown codes and status text.
describe.each(Object.entries(operations))('%s diagnostics', (_name, operation) => {
  it.each(bodies)('does not expose provider content from %s', async (body) => {
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response(body, { status: 400, statusText: secret }),
    );
    const failure = await operation().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GitLabOAuthHttpError);
    expect((failure as GitLabOAuthHttpError).status).toBe(400);
    expect((failure as GitLabOAuthHttpError).oauthError).toBe(
      body === bodies[0] ? 'invalid_grant' : undefined,
    );
    logger.error({ err: new Error('outer failure', { cause: failure }) }, 'Caller diagnostic');
    expect(inspect(failure, { depth: null })).not.toContain(secret);
    expect(output).toContain('400');
    expect(output).not.toContain(secret);
    expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
  });
});

// Malformed device responses must not leak JSON parser excerpts or free-form descriptions.
it.each(bodies)('sanitizes device polling errors from %s', async (body) => {
  mockEnhancedFetch.mockResolvedValueOnce(new Response(body, { status: 400, statusText: secret }));
  const failure = await pollDeviceFlowStep('device', config).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  logger.warn({ err: failure }, 'Polling failed');
  expect(inspect(failure, { depth: null })).not.toContain(secret);
  expect(output).not.toContain(secret);
});

// Exact standard codes remain machine-readable; a code's description is never diagnostic data.
it.each([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'authorization_pending',
  'slow_down',
  'access_denied',
  'expired_token',
  'server_error',
  'temporarily_unavailable',
])('preserves the allowed code %s', async (code) => {
  mockEnhancedFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: code, error_description: secret }), { status: 400 }),
  );
  await expect(refreshGitLabToken('refresh', config)).rejects.toMatchObject({
    message: `Failed to refresh token: 400 ${code}`,
    status: 400,
    oauthError: code,
  });
  expect(output).not.toContain(secret);
});

// Reading a rejected body can fail too; its exception must not replace the sanitized HTTP error.
it('omits exceptions thrown while reading a rejected body', async () => {
  const response = new Response('', { status: 502 });
  jest.spyOn(response, 'text').mockRejectedValue(new Error(secret));
  mockEnhancedFetch.mockResolvedValueOnce(response);
  const failure = await refreshGitLabToken('refresh', config).catch((error: unknown) => error);
  expect(failure).toMatchObject({ status: 502, message: 'Failed to refresh token: 502' });
  expect(inspect(failure, { depth: null })).not.toContain(secret);
  expect(output).not.toContain(secret);
});

// The real code-exchange failure propagates through the callback without entering the redirect.
it('keeps provider secrets out of callback redirects and serialized logs', async () => {
  mockEnhancedFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'invalid_grant', error_description: secret }), {
      status: 400,
    }),
  );
  const redirect = jest.fn();
  await callbackHandler(
    { query: { code: 'code', state: 'state' } } as unknown as Request,
    { redirect } as unknown as ExpressResponse,
  );
  expect(redirect).toHaveBeenCalledTimes(1);
  const target = new URL(redirect.mock.calls[0][0]);
  expect(target.searchParams.get('error')).toBe('server_error');
  expect(target.searchParams.get('error_description')).toContain('400');
  expect(decodeURIComponent(target.href)).not.toContain(secret);
  expect(output).toContain('Failed to complete authorization code flow');
  expect(output).not.toContain(secret);
});

// Exercise Express's actual HTTP redirect serialization as well as the client error boundary.
it('returns a sanitized callback failure over HTTP', async () => {
  mockEnhancedFetch.mockResolvedValueOnce(
    new Response(`<html>${secret}</html>`, { status: 502, statusText: secret }),
  );
  const app = express();
  app.get('/oauth/callback', callbackHandler);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth/callback?code=code&state=state`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error_description')).toBe(
      'Failed to exchange authorization code: 502',
    );
    expect(await response.text()).not.toContain(secret);
    expect(decodeURIComponent(location.href)).not.toContain(secret);
    expect(output).not.toContain(secret);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

// Both login and account-link callbacks can receive provider text before any token HTTP request.
describe.each(['redirect', 'json', 'link'] as const)('%s callback refusal', (destination) => {
  it.each([
    'invalid_request',
    'unauthorized_client',
    'access_denied',
    'unsupported_response_type',
    'invalid_scope',
    'server_error',
    'temporarily_unavailable',
    secret,
  ])('never repeats provider text for %s', async (code) => {
    const flow = (await sessionStore.getAuthCodeFlow('state'))!;
    jest.mocked(sessionStore.consumeAuthCodeFlow).mockResolvedValue(
      destination === 'json'
        ? undefined
        : {
            ...flow,
            ...(destination === 'link' && {
              link: {
                sessionId: 'primary',
                stage: 'connect' as const,
                instance: 'https://gitlab.example.com',
              },
            }),
          },
    );
    const redirect = jest.fn();
    const json = jest.fn();
    const response = { redirect, json, status: jest.fn().mockReturnThis() };
    await callbackHandler(
      { query: { error: code, error_description: secret, state: 'state' } } as unknown as Request,
      response as unknown as ExpressResponse,
    );
    if (destination === 'redirect') {
      expect(redirect).toHaveBeenCalledTimes(1);
      const target = new URL(redirect.mock.calls[0][0]);
      expect(target.searchParams.get('error')).toBe(code === secret ? 'server_error' : code);
      expect(target.searchParams.get('error_description')).toBe('GitLab authorization failed');
      expect(decodeURIComponent(target.href)).not.toContain(secret);
    } else if (destination === 'json') {
      expect(json).toHaveBeenCalledWith({
        error: code === secret ? 'server_error' : code,
        error_description: 'GitLab authorization failed',
      });
    } else {
      expect(failAccountLink).toHaveBeenCalledWith(
        response,
        'GitLab did not authorize the account. Ask for a new link in the chat to try again.',
      );
    }
    expect(output).toContain('GitLab authorization error');
    expect(output).not.toContain(secret);
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });
});

// Express represents repeated query parameters as arrays; do not coerce them into diagnostics.
it('normalizes a non-string callback error without exposing its contents', async () => {
  jest.mocked(sessionStore.consumeAuthCodeFlow).mockResolvedValue(undefined);
  const json = jest.fn();
  const response = { json, status: jest.fn().mockReturnThis() };
  await callbackHandler(
    { query: { error: [secret], error_description: secret } } as unknown as Request,
    response as unknown as ExpressResponse,
  );
  expect(json).toHaveBeenCalledWith({
    error: 'server_error',
    error_description: 'GitLab authorization failed',
  });
  expect(output).not.toContain(secret);
});
