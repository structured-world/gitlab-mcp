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
import { loadOAuthConfig } from '../config';
import { sessionStore } from '../session-store';
import {
  initiateDeviceFlow,
  pollDeviceFlowStep,
  getGitLabUser,
  buildGitLabAuthUrl,
} from '../gitlab-device-flow';
import {
  generateRandomString,
  generateSessionId,
  generateAuthorizationCode,
  calculateTokenExpiry,
} from '../token-utils';
import { GITLAB_BASE_URL } from '../../config';
import { logInfo, logWarn, logError, truncateId } from '../../logger';
import { DeviceFlowPollResponse, OAuthErrorResponse } from '../types';
import { getIpAddress } from '../../utils/request-logger';
import { grantedGitlabScopes } from '../granted-scopes';
import { getRegisteredClient } from './register';
import { MCP_SCOPES, grantedMcpScopes, matchProtectedResource } from '../resource';
import { authorizationRedirect } from '../authorization-response';
import { oauthAppFor, selectableOAuthApps } from '../instance-app';
import type { GitLabOAuthApp } from '../oauth-app';
import { normalizeInstanceUrl } from '../../utils/url';
import { escapeHtml } from '../../utils/html';

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
export async function authorizeHandler(req: Request, res: Response): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    sendError(req, res, 500, 'server_error', 'OAuth not configured');
    return;
  }

  // Extract query parameters
  const {
    client_id,
    redirect_uri,
    response_type,
    state,
    code_challenge,
    code_challenge_method,
    scope,
  } = req.query as Record<string, string | undefined>;

  // Validate required parameters
  if (response_type !== 'code') {
    sendError(req, res, 400, 'unsupported_response_type', 'Only "code" response type is supported');
    return;
  }

  if (!client_id) {
    sendError(req, res, 400, 'invalid_request', 'client_id is required');
    return;
  }

  // PKCE is required for OAuth 2.1
  if (!code_challenge) {
    sendError(req, res, 400, 'invalid_request', 'code_challenge is required (PKCE)');
    return;
  }

  if (code_challenge_method !== 'S256') {
    sendError(req, res, 400, 'invalid_request', 'code_challenge_method must be "S256"');
    return;
  }

  // A redirect goes only to a URI the client registered; an unknown client or an
  // unregistered URI is reported here, never redirected (RFC 6749 section 4.1.2.1).
  if (redirect_uri) {
    let client;
    try {
      client = await getRegisteredClient(client_id);
    } catch (error: unknown) {
      logError('Failed to read client registration', { err: error as Error });
      sendError(req, res, 500, 'server_error', 'Failed to start authorization');
      return;
    }
    if (!client) {
      sendError(
        req,
        res,
        400,
        'invalid_request',
        'Unknown client_id; register the client via /register',
      );
      return;
    }
    if (!client.redirect_uris.includes(redirect_uri)) {
      sendError(req, res, 400, 'invalid_request', 'redirect_uri is not registered for this client');
      return;
    }
  }

  // RFC 8707 section 2: a resource that is not ours is rejected with invalid_target.
  const requestedResource = req.query.resource;
  let resource: string | undefined;
  if (requestedResource !== undefined) {
    resource =
      typeof requestedResource === 'string'
        ? matchProtectedResource(config.issuer, requestedResource)
        : undefined;
    if (!resource) {
      const description = 'resource must name this MCP server';
      if (redirect_uri) {
        res.redirect(
          authorizationRedirect(redirect_uri, config.issuer, {
            error: 'invalid_target',
            error_description: description,
            state,
          }),
        );
      } else {
        sendError(req, res, 400, 'invalid_target', description);
      }
      return;
    }
  }
  const scopes = grantedMcpScopes(scope);

  // The GitLab instance comes only from the operator's configuration: a requested URL
  // selects one of the configured instances or the request fails.
  const apps = await selectableOAuthApps(config);
  const requestedInstance = req.query.instance;
  let app: GitLabOAuthApp | undefined;
  if (requestedInstance === undefined) {
    if (apps.length > 1) {
      res.setHeader('Content-Type', 'text/html');
      res.send(getInstanceChooserHTML(config.issuer, req.query, apps));
      return;
    }
    app = apps[0];
  } else if (typeof requestedInstance === 'string') {
    const wanted = normalizeInstanceUrl(requestedInstance);
    app = apps.find((candidate) => candidate.baseUrl === wanted);
  }
  if (!app) {
    const description = 'instance is not a configured GitLab instance';
    if (redirect_uri) {
      res.redirect(
        authorizationRedirect(redirect_uri, config.issuer, {
          error: 'invalid_request',
          error_description: description,
          state,
        }),
      );
    } else {
      sendError(req, res, 400, 'invalid_request', description);
    }
    return;
  }

  // Determine which flow to use based on redirect_uri presence
  if (redirect_uri) {
    // Authorization Code Flow - redirect to GitLab
    await handleAuthorizationCodeFlow(req, res, config, {
      clientId: client_id,
      redirectUri: redirect_uri,
      state: state ?? '',
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      scopes,
      resource,
      app,
    });
  } else {
    // Device Flow - show HTML page
    await handleDeviceFlow(req, res, config, {
      clientId: client_id,
      state: state ?? '',
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      scopes,
      resource,
      app,
    });
  }
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

  const { flow_state } = req.query as { flow_state?: string };

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
  // page or another replica asks.
  if (flow.nextPollAt !== undefined && Date.now() < flow.nextPollAt) {
    res.json({ status: 'pending', interval: flow.interval });
    return;
  }

  try {
    // Single poll attempt to GitLab
    const step = await pollDeviceFlowStep(flow.deviceCode, config, app);

    if (step.status === 'complete') {
      // Exactly one poller completes the flow, so one session and one code are created.
      if (!(await sessionStore.consumeDeviceFlow(flow_state))) {
        res.json({ status: 'pending', interval: flow.interval });
        return;
      }
      const tokenResponse = step.tokens;
      // Success! Get user info and create session
      const userInfo = await getGitLabUser(tokenResponse.access_token, app.baseUrl);

      const sessionId = generateSessionId();
      const now = Date.now();

      // Generate authorization code for the OAuth flow
      const authCode = generateAuthorizationCode();

      // Create session with GitLab tokens before the code that references it.
      // MCP tokens will be set when the authorization code is exchanged
      await sessionStore.createSession({
        id: sessionId,
        mcpAccessToken: '', // Set on /token
        mcpRefreshToken: '', // Set on /token
        mcpTokenExpiry: 0, // Set on /token
        gitlabAccessToken: tokenResponse.access_token,
        gitlabRefreshToken: tokenResponse.refresh_token,
        gitlabTokenExpiry: calculateTokenExpiry(tokenResponse.expires_in),
        gitlabScopes: grantedGitlabScopes(tokenResponse.scope, flow.requestedGitlabScopes),
        gitlabUserId: userInfo.id,
        gitlabUsername: userInfo.username,
        gitlabApiUrl: flow.selectedInstance ?? GITLAB_BASE_URL,
        instanceLabel: flow.selectedInstanceLabel,
        clientId: flow.clientId,
        scopes: flow.scopes ?? [...MCP_SCOPES],
        resource: flow.resource,
        createdAt: now,
        updatedAt: now,
      });

      // Store authorization code (single-use, expires in 10 minutes)
      await sessionStore.storeAuthCode({
        code: authCode,
        sessionId,
        clientId: flow.clientId,
        codeChallenge: flow.codeChallenge,
        codeChallengeMethod: flow.codeChallengeMethod,
        redirectUri: flow.redirectUri,
        expiresAt: now + 10 * 60 * 1000, // 10 minutes
      });

      logInfo('Device flow authorization completed', {
        sessionId: truncateId(sessionId),
        userId: userInfo.id,
        username: userInfo.username,
      });

      // Return success with redirect info
      const response: DeviceFlowPollResponse = {
        status: 'complete',
        redirect_uri: flow.redirectUri,
        code: authCode,
        state: flow.state ? flow.state : undefined,
        iss: config.issuer,
      };

      res.json(response);
    } else {
      // Still pending; slow_down adds 5 seconds to this and every later interval.
      const interval = step.status === 'slow_down' ? flow.interval + 5 : flow.interval;
      await sessionStore.storeDeviceFlow(flow_state, {
        ...flow,
        interval,
        nextPollAt: Date.now() + interval * 1000,
      });
      res.json({ status: 'pending', interval });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Check for terminal errors
    if (message.includes('expired') || message.includes('denied') || message.includes('invalid')) {
      await sessionStore.deleteDeviceFlow(flow_state);
      res.json({ status: 'failed', error: message });
    } else {
      // Transient error - report as pending
      logWarn('Device flow poll error', { err: error as Error });
      res.json({ status: 'pending', interval: flow.interval });
    }
  }
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
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(query)) {
        if (typeof value === 'string' && name !== 'instance') params.set(name, value);
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
