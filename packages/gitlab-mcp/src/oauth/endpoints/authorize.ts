/**
 * OAuth Authorization Endpoint
 *
 * Handles the authorization request by initiating GitLab device flow
 * and presenting a page for the user to complete authentication.
 *
 * Flow:
 * 1. Client sends authorization request with PKCE
 * 2. Server initiates GitLab device flow
 * 3. Server returns HTML page with device code instructions
 * 4. Client polls /oauth/poll until user completes auth
 * 5. Server returns authorization code for token exchange
 */

import { Request, Response } from 'express';
import { loadOAuthConfig, type OAuthConfig } from '../config';
import { sessionStore } from '../session-store';
import { keepIssuedTokens } from '../issued-tokens';
import {
  initiateDeviceFlow,
  pollDeviceFlowStep,
  getGitLabUser,
  buildGitLabAuthUrl,
  GitLabOAuthHttpError,
  DeviceGrantRefusedError,
} from '../gitlab-device-flow';
import {
  generateRandomString,
  generateSessionId,
  generateAuthorizationCode,
  calculateTokenExpiry,
} from '../token-utils';
import { GITLAB_BASE_URL } from '../../config';
import { logInfo, logWarn, logError, truncateId } from '../../logger';
import {
  DeviceFlowPollResponse,
  DeviceFlowState,
  GitLabTokenResponse,
  OAuthErrorResponse,
} from '../types';
import { getIpAddress } from '../../utils/request-logger';
import { grantedGitlabScopes } from '../granted-scopes';
import { getRegisteredClient } from './register';
import { MCP_SCOPES, grantedMcpScopes, resourceParameter } from '../resource';
import { authorizationRedirect } from '../authorization-response';
import { oauthAppFor, selectableOAuthApps } from '../instance-app';
import type { GitLabOAuthApp } from '../oauth-app';
import { normalizeInstanceUrl } from '../../utils/url';
import { escapeHtml } from '../../utils/html';
import { GITLAB_REQUEST_MAX_MS } from '../gitlab-request-bound';

/**
 * Authorization endpoint handler
 *
 * Handles GET /authorize requests from OAuth clients.
 *
 * Supports TWO authorization flows:
 *
 * 1. Authorization Code Flow (when redirect_uri is present):
 *    - Used by web clients like Claude.ai
 *    - Redirects user to GitLab for authorization
 *    - GitLab redirects back to /oauth/callback
 *    - Callback creates session and redirects to client's redirect_uri
 *
 * 2. Device Flow (when redirect_uri is absent):
 *    - Used by CLI clients without browser
 *    - Returns HTML page with device code
 *    - Client polls /oauth/poll until authorization completes
 *
 * Required query parameters:
 * - response_type: Must be "code"
 * - client_id: OAuth client ID
 * - code_challenge: PKCE code challenge
 * - code_challenge_method: Must be "S256"
 *
 * Optional query parameters:
 * - redirect_uri: Where to redirect after authorization (triggers Auth Code Flow)
 * - state: CSRF protection token
 * - scope: Requested scopes
 */
const SINGLE_VALUED_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'instance',
] as const;

type SingleValuedParams = Partial<Record<(typeof SINGLE_VALUED_PARAMS)[number], string>>;

/**
 * A refused authorization request. A redirectable refusal goes to the client's registered
 * redirect URI when there is one (RFC 6749 section 4.1.2.1); any other is answered here.
 */
interface Rejection {
  rejected: true;
  status: number;
  error: string;
  description: string;
  redirectable?: boolean;
}

function rejection(
  status: number,
  error: string,
  description: string,
  redirectable = false,
): Rejection {
  return { rejected: true, status, error, description, redirectable };
}

function isRejection(value: unknown): value is Rejection {
  return typeof value === 'object' && value !== null && 'rejected' in value;
}

/**
 * RFC 6749 section 3.1: parameters must not repeat. Reported without a redirect, since a
 * repeated redirect_uri has no single target. `resource` may repeat (RFC 8707 section 2)
 * and is checked separately. Only values checked to be strings are read further.
 */
function singleValuedParams(query: Request['query']): SingleValuedParams | Rejection {
  const params: SingleValuedParams = {};
  for (const name of SINGLE_VALUED_PARAMS) {
    const value = query[name];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      return rejection(400, 'invalid_request', `${name} must not be repeated`);
    }
    params[name] = value;
  }
  return params;
}

/** The required parameters; PKCE with S256 is mandatory in OAuth 2.1. */
function requiredParams(
  params: SingleValuedParams,
): { clientId: string; codeChallenge: string } | Rejection {
  if (params.response_type !== 'code') {
    return rejection(400, 'unsupported_response_type', 'Only "code" response type is supported');
  }
  if (!params.client_id) return rejection(400, 'invalid_request', 'client_id is required');
  if (!params.code_challenge) {
    return rejection(400, 'invalid_request', 'code_challenge is required (PKCE)');
  }
  if (params.code_challenge_method !== 'S256') {
    return rejection(400, 'invalid_request', 'code_challenge_method must be "S256"');
  }
  return { clientId: params.client_id, codeChallenge: params.code_challenge };
}

/**
 * The registered redirect URI the request names, or undefined for the device flow. An
 * unknown client or an unregistered URI is refused without a redirect (RFC 6749 section
 * 4.1.2.1); the returned value comes from the registration, never the request's copy.
 */
async function registeredRedirectUri(
  clientId: string,
  requested: string | undefined,
): Promise<string | undefined | Rejection> {
  if (!requested) return undefined;
  let client;
  try {
    client = await getRegisteredClient(clientId);
  } catch (error: unknown) {
    logError('Failed to read client registration', { err: error as Error });
    return rejection(500, 'server_error', 'Failed to start authorization');
  }
  if (!client) {
    return rejection(
      400,
      'invalid_request',
      'Unknown client_id; register the client via /register',
    );
  }
  return (
    client.redirect_uris.find((registered) => registered === requested) ??
    rejection(400, 'invalid_request', 'redirect_uri is not registered for this client')
  );
}

/** RFC 8707 section 2: a resource that is not ours is refused with invalid_target. */
function requestedResource(issuer: string, value: unknown): string | undefined | Rejection {
  const resource = resourceParameter(issuer, value);
  return resource === null
    ? rejection(400, 'invalid_target', 'resource must name this MCP server', true)
    : resource;
}

/**
 * The GitLab instance comes only from the operator's configuration: a requested URL
 * selects one of the configured instances or the request is refused.
 */
function requestedApp(
  apps: GitLabOAuthApp[],
  requestedInstance: string | undefined,
): GitLabOAuthApp | Rejection {
  const wanted =
    requestedInstance === undefined ? undefined : normalizeInstanceUrl(requestedInstance);
  const app =
    wanted === undefined ? apps[0] : apps.find((candidate) => candidate.baseUrl === wanted);
  return (
    app ?? rejection(400, 'invalid_request', 'instance is not a configured GitLab instance', true)
  );
}

export async function authorizeHandler(req: Request, res: Response): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    sendError(req, res, 500, 'server_error', 'OAuth not configured');
    return;
  }

  const params = singleValuedParams(req.query);
  if (isRejection(params)) {
    sendRejection(req, res, params);
    return;
  }
  const required = requiredParams(params);
  if (isRejection(required)) {
    sendRejection(req, res, required);
    return;
  }
  const redirectUri = await registeredRedirectUri(required.clientId, params.redirect_uri);
  if (isRejection(redirectUri)) {
    sendRejection(req, res, redirectUri);
    return;
  }
  const refuse = (refusal: Rejection): void => {
    if (refusal.redirectable && redirectUri) {
      res.redirect(
        authorizationRedirect(redirectUri, config.issuer, {
          error: refusal.error,
          error_description: refusal.description,
          state: params.state,
        }),
      );
    } else {
      sendRejection(req, res, refusal);
    }
  };

  const resource = requestedResource(config.issuer, req.query.resource);
  if (isRejection(resource)) {
    refuse(resource);
    return;
  }
  const scopes = grantedMcpScopes(params.scope);

  const apps = await selectableOAuthApps(config);
  if (params.instance === undefined && apps.length > 1) {
    res.setHeader('Content-Type', 'text/html');
    res.send(getInstanceChooserHTML(config.issuer, req.query, apps));
    return;
  }
  const app = requestedApp(apps, params.instance);
  if (isRejection(app)) {
    refuse(app);
    return;
  }

  const flow = {
    clientId: required.clientId,
    state: params.state ?? '',
    codeChallenge: required.codeChallenge,
    codeChallengeMethod: 'S256',
    scopes,
    resource,
    app,
  };
  // Determine which flow to use based on redirect_uri presence
  if (redirectUri) {
    // Authorization Code Flow - redirect to GitLab
    await handleAuthorizationCodeFlow(req, res, config, { ...flow, redirectUri });
  } else {
    // Device Flow - show HTML page
    await handleDeviceFlow(req, res, config, flow);
  }
}

function sendRejection(req: Request, res: Response, refusal: Rejection): void {
  sendError(req, res, refusal.status, refusal.error, refusal.description);
}

/**
 * Handle Authorization Code Flow
 *
 * Redirects user to GitLab for authorization.
 * GitLab will redirect back to /oauth/callback after authorization.
 */
async function handleAuthorizationCodeFlow(
  req: Request,
  res: Response,
  config: ReturnType<typeof loadOAuthConfig> & object,
  params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scopes: string[];
    resource?: string;
    app: GitLabOAuthApp;
  },
): Promise<void> {
  // Registered in the GitLab application as <OAUTH_ISSUER>/oauth/callback.
  const callbackUri = `${config.issuer}/oauth/callback`;

  // Generate internal state for GitLab callback
  const internalState = generateRandomString(32);

  // Store auth code flow state (expires in 10 minutes). The callback may land on another
  // replica, so the browser goes to GitLab only once the flow is stored.
  try {
    await sessionStore.storeAuthCodeFlow(internalState, {
      requestedGitlabScopes: params.app.scopes.split(/[,\s]+/).filter(Boolean),
      selectedInstance: params.app.baseUrl,
      selectedInstanceLabel: params.app.label,
      clientId: params.clientId,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      clientState: params.state,
      internalState: internalState,
      clientRedirectUri: params.redirectUri,
      callbackUri: callbackUri,
      expiresAt: Date.now() + 10 * 60 * 1000,
      scopes: params.scopes,
      resource: params.resource,
    });
  } catch (error: unknown) {
    logError('Failed to store authorization flow', { err: error as Error });
    res.redirect(
      authorizationRedirect(params.redirectUri, config.issuer, {
        error: 'temporarily_unavailable',
        error_description: 'Authorization could not be started; try again',
        state: params.state,
      }),
    );
    return;
  }

  // Build GitLab authorization URL
  const gitlabAuthUrl = buildGitLabAuthUrl(config, callbackUri, internalState, params.app);

  logInfo('Authorization Code Flow initiated, redirecting to GitLab', {
    internalState: truncateId(internalState),
    clientRedirectUri: params.redirectUri,
  });

  // Redirect user to GitLab for authorization
  res.redirect(gitlabAuthUrl);
}

/**
 * Handle Device Flow
 *
 * Initiates GitLab device flow and returns HTML page with instructions.
 */
async function handleDeviceFlow(
  req: Request,
  res: Response,
  config: ReturnType<typeof loadOAuthConfig> & object,
  params: {
    clientId: string;
    state: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scopes: string[];
    resource?: string;
    app: GitLabOAuthApp;
  },
): Promise<void> {
  try {
    // Initiate GitLab device flow
    const deviceResponse = await initiateDeviceFlow(config, params.app);

    // Generate a unique state for this device flow
    const flowState = generateRandomString(32);

    // GitLab's interval is the minimum (RFC 8628 3.2); OAUTH_DEVICE_POLL_INTERVAL raises it.
    // GitLab's expires_in is the maximum; OAUTH_DEVICE_TIMEOUT shortens it.
    const interval = Math.max(deviceResponse.interval, config.devicePollInterval);
    const lifetime = Math.min(deviceResponse.expires_in, config.deviceTimeout);
    const startedAt = Date.now();

    // Store device flow state
    await sessionStore.storeDeviceFlow(flowState, {
      requestedGitlabScopes: params.app.scopes.split(/[,\s]+/).filter(Boolean),
      selectedInstance: params.app.baseUrl,
      selectedInstanceLabel: params.app.label,
      deviceCode: deviceResponse.device_code,
      userCode: deviceResponse.user_code,
      verificationUri: deviceResponse.verification_uri,
      verificationUriComplete: deviceResponse.verification_uri_complete,
      expiresAt: startedAt + lifetime * 1000,
      interval,
      nextPollAt: startedAt + interval * 1000,
      clientId: params.clientId,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      state: params.state,
      redirectUri: undefined,
      scopes: params.scopes,
      resource: params.resource,
    });

    logInfo('Device flow initiated for authorization', {
      flowState: truncateId(flowState),
      userCode: deviceResponse.user_code,
    });

    // Return HTML page with device flow instructions
    const html = getDeviceFlowHTML({
      userCode: deviceResponse.user_code,
      verificationUri: deviceResponse.verification_uri,
      verificationUriComplete: deviceResponse.verification_uri_complete,
      flowState,
      pollUrl: `${config.issuer}/oauth/poll`,
      expiresIn: lifetime,
      interval,
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error: unknown) {
    // GitLab has the device grant from 17.2 behind a flag, on by default from 17.3
    // (https://docs.gitlab.com/api/oauth2/#device-authorization-grant-flow); older
    // instances have no such endpoint, and without redirect_uri there is no other flow.
    if (error instanceof GitLabOAuthHttpError && error.status === 404) {
      sendError(
        req,
        res,
        400,
        'invalid_request',
        'This GitLab instance does not support device authorization (GitLab 17.3 or later); ' +
          'authorize with a redirect_uri instead',
      );
      return;
    }
    logError('Failed to initiate device flow', { err: error as Error });
    sendError(req, res, 500, 'server_error', 'Failed to initiate authentication');
  }
}

/**
 * Device flow poll endpoint handler
 *
 * Handles GET /oauth/poll requests from the authorization page.
 * Polls GitLab to check if user has completed authorization.
 *
 * Query parameters:
 * - flow_state: Device flow state identifier
 */
export async function pollHandler(req: Request, res: Response): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    res.status(500).json({ error: 'server_error' });
    return;
  }

  const flow_state = typeof req.query.flow_state === 'string' ? req.query.flow_state : undefined;

  if (!flow_state) {
    res.status(400).json({ status: 'failed', error: 'Missing flow_state' });
    return;
  }

  let flow;
  try {
    flow = await sessionStore.getDeviceFlow(flow_state);
  } catch (error: unknown) {
    // Storage outage: keep the page polling rather than reporting a failed sign-in.
    logWarn('Device flow lookup failed', { err: error as Error });
    res.status(503).json({ status: 'pending' });
    return;
  }

  if (!flow) {
    res.status(400).json({ status: 'expired', error: 'Flow not found' });
    return;
  }

  // Check if device flow has expired
  if (Date.now() > flow.expiresAt) {
    await sessionStore.deleteDeviceFlow(flow_state);
    res.status(400).json({ status: 'expired', error: 'Device code expired' });
    return;
  }

  // The instance chosen at /authorize; never another one if it is no longer configured.
  const app = await oauthAppFor(config, flow.selectedInstance);
  if (!app) {
    await sessionStore.deleteDeviceFlow(flow_state);
    res.json({ status: 'failed', error: 'GitLab instance is no longer configured' });
    return;
  }

  // RFC 8628 3.5: never poll GitLab sooner than the flow's interval, however often the
  // page or another replica asks. The reservation is atomic and lasts until this poll's
  // GitLab requests can no longer be running, so no other replica presents the same
  // single-use device code meanwhile; the poll's outcome then sets the next poll one
  // interval later.
  const now = Date.now();
  const reservedUntil = now + Math.max(flow.interval * 1000, GITLAB_REQUEST_MAX_MS);
  // The reservation returns the stored flow: GitLab tokens or a slowed interval another
  // replica stored since the read above are used and kept.
  const claimed = await sessionStore.claimDevicePoll(flow_state, now, reservedUntil);
  if (!claimed) {
    res.json({ status: 'pending', interval: flow.interval });
    return;
  }

  try {
    const tokens =
      claimed.gitlabTokens ?? (await pollGitLab(flow_state, claimed, config, app, now));
    if (!('access_token' in tokens)) {
      res.json({ status: 'pending', interval: tokens.interval });
      return;
    }
    const response = await completeDeviceFlow(flow_state, claimed, tokens, config, app);
    res.json(response ?? { status: 'pending', interval: claimed.interval });
  } catch (error: unknown) {
    // Only GitLab refusing the device grant ends the flow. Any other failure, including one
    // while completing an approved flow, keeps it (and its GitLab tokens) for the next poll.
    if (error instanceof DeviceGrantRefusedError) {
      await sessionStore.deleteDeviceFlow(flow_state);
      res.json({ status: 'failed', error: error.message });
    } else {
      // Poll again one interval from now rather than when the reservation would run out
      logWarn('Device flow poll error', { err: error as Error });
      await reschedulePoll(flow_state, claimed.interval);
      res.json({ status: 'pending', interval: claimed.interval });
    }
  }
}

/**
 * Remove the session and code a completion created when another request completed the
 * same flow first; best effort, since the code expires and cannot be exchanged without
 * its session.
 */
export async function discardCompletion(sessionId: string, code: string): Promise<void> {
  try {
    await sessionStore.deleteAuthCode(code);
    await sessionStore.deleteSession(sessionId);
  } catch (error: unknown) {
    logWarn('Failed to remove the session of a duplicate completion', { err: error as Error });
  }
}

/** Set the next poll of a flow one interval from now; best effort. */
async function reschedulePoll(flowState: string, interval: number): Promise<void> {
  try {
    // Re-read: the failed poll may have stored GitLab tokens with the flow already.
    const current = await sessionStore.getDeviceFlow(flowState);
    if (current) {
      await sessionStore.storeDeviceFlow(flowState, {
        ...current,
        nextPollAt: Date.now() + interval * 1000,
      });
    }
  } catch (error: unknown) {
    logWarn('Failed to reschedule device flow poll', { err: error as Error });
  }
}

/**
 * One poll of GitLab for a reserved interval: the issued tokens, or the interval to wait
 * while the user has not approved yet.
 */
async function pollGitLab(
  flowState: string,
  flow: DeviceFlowState,
  config: OAuthConfig,
  app: GitLabOAuthApp,
  now: number,
): Promise<GitLabTokenResponse | { interval: number }> {
  const step = await pollDeviceFlowStep(flow.deviceCode, config, app);
  if (step.status !== 'complete') {
    // Still pending; slow_down adds 5 seconds to this and every later interval.
    const interval = step.status === 'slow_down' ? flow.interval + 5 : flow.interval;
    await sessionStore.storeDeviceFlow(flowState, {
      ...flow,
      interval,
      nextPollAt: Date.now() + interval * 1000,
    });
    return { interval };
  }
  // GitLab issues these tokens once: keep them with the flow before anything else can
  // fail, so the next poll finishes the setup instead of losing the authorization.
  await keepIssuedTokens(() =>
    sessionStore.storeDeviceFlow(flowState, {
      ...flow,
      nextPollAt: now + flow.interval * 1000,
      gitlabTokens: step.tokens,
    }),
  );
  return step.tokens;
}

/**
 * Create the session and authorization code of an approved device flow. Undefined when
 * another poller completed the flow first.
 */
async function completeDeviceFlow(
  flowState: string,
  flow: DeviceFlowState,
  tokens: GitLabTokenResponse,
  config: OAuthConfig,
  app: GitLabOAuthApp,
): Promise<DeviceFlowPollResponse | undefined> {
  const userInfo = await getGitLabUser(tokens.access_token, app.baseUrl);

  // The session and code are stored before the flow is consumed: until then the flow
  // keeps GitLab's tokens, so a storage failure here is retried by the next poll.
  const sessionId = generateSessionId();
  const createdAt = Date.now();

  // Generate authorization code for the OAuth flow
  const authCode = generateAuthorizationCode();

  // Create session with GitLab tokens before the code that references it.
  // MCP tokens will be set when the authorization code is exchanged
  await sessionStore.createSession({
    id: sessionId,
    mcpAccessToken: '', // Set on /token
    mcpRefreshToken: '', // Set on /token
    mcpTokenExpiry: 0, // Set on /token
    gitlabAccessToken: tokens.access_token,
    gitlabRefreshToken: tokens.refresh_token,
    gitlabTokenExpiry: calculateTokenExpiry(tokens.expires_in),
    gitlabScopes: grantedGitlabScopes(tokens.scope, flow.requestedGitlabScopes),
    gitlabUserId: userInfo.id,
    gitlabUsername: userInfo.username,
    gitlabApiUrl: flow.selectedInstance ?? GITLAB_BASE_URL,
    instanceLabel: flow.selectedInstanceLabel,
    clientId: flow.clientId,
    scopes: flow.scopes ?? [...MCP_SCOPES],
    resource: flow.resource,
    createdAt,
    updatedAt: createdAt,
  });

  // Store authorization code (single-use, expires in 10 minutes)
  await sessionStore.storeAuthCode({
    code: authCode,
    sessionId,
    clientId: flow.clientId,
    codeChallenge: flow.codeChallenge,
    codeChallengeMethod: flow.codeChallengeMethod,
    redirectUri: flow.redirectUri,
    expiresAt: createdAt + 10 * 60 * 1000, // 10 minutes
  });

  // Exactly one poller completes the flow; another one removes what it created.
  if (!(await sessionStore.consumeDeviceFlow(flowState))) {
    await discardCompletion(sessionId, authCode);
    return undefined;
  }

  logInfo('Device flow authorization completed', {
    sessionId: truncateId(sessionId),
    userId: userInfo.id,
    username: userInfo.username,
  });

  // Return success with redirect info
  return {
    status: 'complete',
    redirect_uri: flow.redirectUri,
    code: authCode,
    state: flow.state ? flow.state : undefined,
    iss: config.issuer,
  };
}

/**
 * Generate HTML page for device flow instructions
 */
interface DeviceFlowHTMLParams {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  flowState: string;
  pollUrl: string;
  expiresIn: number;
  /** Initial poll interval in seconds; the server may raise it in later responses. */
  interval: number;
}

/**
 * Page listing the configured instances; each link repeats the authorization request with
 * `instance` set, so the rest of the request is unchanged.
 */
function getInstanceChooserHTML(
  issuer: string,
  query: Request['query'],
  apps: GitLabOAuthApp[],
): string {
  const links = apps
    .map((app) => {
      // Every string value is kept, repeated ones included (`resource` may repeat, RFC 8707
      // section 2); nested values come from no OAuth parameter and are dropped. The request
      // named no instance (one that names one is never shown this page).
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(query)) {
        for (const entry of Array.isArray(value) ? value : [value]) {
          if (typeof entry === 'string') params.append(name, entry);
        }
      }
      params.set('instance', app.baseUrl);
      const href = escapeHtml(`${issuer}/authorize?${params.toString()}`);
      const label = app.label
        ? `${escapeHtml(app.label)} <small>${escapeHtml(app.baseUrl)}</small>`
        : escapeHtml(app.baseUrl);
      return `<li><a href="${href}">${label}</a></li>`;
    })
    .join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitLab MCP - Choose GitLab instance</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #f5f5f5; }
    .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #333; font-size: 24px; margin: 0 0 20px; }
    ul { list-style: none; padding: 0; }
    li { margin: 12px 0; }
    a { display: block; padding: 14px 18px; border: 1px solid #ddd; border-radius: 8px; color: #333; text-decoration: none; }
    a:hover { border-color: #fc6d26; }
    small { display: block; color: #888; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Choose the GitLab instance to sign in to</h1>
    <ul>
      ${links}
    </ul>
  </div>
</body>
</html>`;
}

/**
 * Send an OAuth error response
 *
 * Logs the error before sending the response for debugging and monitoring.
 */
function sendError(
  req: Request,
  res: Response,
  status: number,
  error: string,
  description: string,
): void {
  // Log OAuth error with structured context
  logWarn('OAuth authorize request failed', {
    event: 'oauth_error',
    endpoint: '/authorize',
    ip: getIpAddress(req),
    error,
    description,
  });

  const response: OAuthErrorResponse = {
    error,
    error_description: description,
  };
  res.status(status).json(response);
}

function getDeviceFlowHTML(params: DeviceFlowHTMLParams): string {
  const linkUrl = params.verificationUriComplete ?? params.verificationUri;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitLab MCP - Authentication</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #f5f5f5;
      min-height: 100vh;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-bottom: 20px;
      font-size: 24px;
    }
    p {
      color: #666;
      line-height: 1.6;
      margin-bottom: 16px;
    }
    .code-container {
      background: #f8f9fa;
      border: 2px dashed #ddd;
      border-radius: 8px;
      padding: 24px;
      margin: 24px 0;
      text-align: center;
    }
    .code {
      font-size: 36px;
      font-weight: bold;
      letter-spacing: 6px;
      color: #333;
      font-family: 'Courier New', monospace;
    }
    .code-label {
      font-size: 12px;
      color: #888;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .link-button {
      display: inline-block;
      background: #fc6d26;
      color: white;
      padding: 14px 28px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 500;
      margin: 16px 0;
      transition: background 0.2s;
    }
    .link-button:hover {
      background: #e24329;
    }
    .status {
      padding: 16px;
      border-radius: 8px;
      margin: 24px 0;
      font-weight: 500;
    }
    .status.pending {
      background: #fff3cd;
      color: #856404;
      border: 1px solid #ffeeba;
    }
    .status.success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    .status.error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    .instructions {
      background: #e8f4fd;
      border-left: 4px solid #0366d6;
      padding: 16px;
      margin: 24px 0;
      border-radius: 0 8px 8px 0;
    }
    .instructions ol {
      margin-left: 20px;
    }
    .instructions li {
      margin: 8px 0;
      color: #444;
    }
    .timer {
      font-size: 14px;
      color: #888;
      margin-top: 16px;
    }
    .gitlab-logo {
      width: 40px;
      height: 40px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="gitlab-logo" viewBox="0 0 380 380" xmlns="http://www.w3.org/2000/svg">
      <path d="M190.2 350.2l62.5-192.5H127.7l62.5 192.5z" fill="#e24329"/>
      <path d="M190.2 350.2l-62.5-192.5H38.4l151.8 192.5z" fill="#fc6d26"/>
      <path d="M38.4 157.7L9.1 247.6c-2.7 8.2.1 17.2 6.9 22.5l174.2 126.6L38.4 157.7z" fill="#fca326"/>
      <path d="M38.4 157.7h89.3L91.4 48.5c-3.3-10.2-17.8-10.2-21.1 0L38.4 157.7z" fill="#e24329"/>
      <path d="M190.2 350.2l62.5-192.5h89.3L190.2 350.2z" fill="#fc6d26"/>
      <path d="M342 157.7l29.3 89.9c2.7 8.2-.1 17.2-6.9 22.5L190.2 396.7 342 157.7z" fill="#fca326"/>
      <path d="M342 157.7h-89.3l36.3-109.2c3.3-10.2 17.8-10.2 21.1 0L342 157.7z" fill="#e24329"/>
    </svg>

    <h1>Authenticate with GitLab</h1>

    <p>To complete authentication, visit GitLab and enter the code below:</p>

    <div class="code-container">
      <div class="code-label">Your Code</div>
      <div class="code">${params.userCode}</div>
    </div>

    <div style="text-align: center;">
      <a href="${linkUrl}" target="_blank" rel="noopener" class="link-button">
        Open GitLab Authentication Page
      </a>
    </div>

    <div class="instructions">
      <strong>Instructions:</strong>
      <ol>
        <li>Click the button above to open GitLab</li>
        <li>Sign in to your GitLab account if needed</li>
        <li>Enter the code shown above</li>
        <li>Click "Authorize" to grant access</li>
        <li>Return here - you'll be redirected automatically</li>
      </ol>
    </div>

    <div id="status" class="status pending">
      Waiting for authentication...
    </div>

    <div class="timer" id="timer">
      Code expires in <span id="countdown">${params.expiresIn}</span> seconds
    </div>
  </div>

  <script>
    const pollUrl = '${params.pollUrl}?flow_state=${params.flowState}';
    // The server sets the cadence and raises it on GitLab slow_down (RFC 8628 3.5).
    let pollInterval = ${params.interval * 1000};
    let countdown = ${params.expiresIn};

    // Update countdown timer
    const countdownEl = document.getElementById('countdown');
    const timerInterval = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(timerInterval);
        document.getElementById('status').className = 'status error';
        document.getElementById('status').textContent = 'Code expired. Please refresh to try again.';
        document.getElementById('timer').style.display = 'none';
      } else {
        countdownEl.textContent = countdown;
      }
    }, 1000);

    // Poll for completion
    async function poll() {
      try {
        const response = await fetch(pollUrl);
        const data = await response.json();

        const statusEl = document.getElementById('status');

        if (data.status === 'complete') {
          clearInterval(timerInterval);
          statusEl.className = 'status success';
          statusEl.textContent = 'Authentication successful! Redirecting...';

          // Build redirect URL with authorization code
          if (data.redirect_uri) {
            const redirectUrl = new URL(data.redirect_uri);
            redirectUrl.searchParams.set('code', data.code);
            if (data.state) {
              redirectUrl.searchParams.set('state', data.state);
            }
            if (data.iss) {
              redirectUrl.searchParams.set('iss', data.iss);
            }

            // Redirect after a brief delay
            setTimeout(() => {
              window.location.href = redirectUrl.toString();
            }, 1000);
          }
          return;
        }

        if (data.status === 'failed' || data.status === 'expired') {
          clearInterval(timerInterval);
          statusEl.className = 'status error';
          statusEl.textContent = 'Authentication failed: ' + (data.error || 'Unknown error');
          document.getElementById('timer').style.display = 'none';
          return;
        }

        // Still pending, continue polling at the interval the server asks for
        if (typeof data.interval === 'number' && data.interval > 0) {
          pollInterval = data.interval * 1000;
        }
        setTimeout(poll, pollInterval);

      } catch (error) {
        console.error('Poll error:', error);
        // Continue polling on transient errors
        setTimeout(poll, pollInterval);
      }
    }

    // Start polling
    setTimeout(poll, pollInterval);
  </script>
</body>
</html>`;
}
