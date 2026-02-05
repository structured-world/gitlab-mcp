import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Express } from "express";
import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import {
  HOST,
  PORT,
  SSL_CERT_PATH,
  SSL_KEY_PATH,
  SSL_CA_PATH,
  SSL_PASSPHRASE,
  TRUST_PROXY,
  SSE_HEARTBEAT_MS,
  HTTP_KEEPALIVE_TIMEOUT_MS,
  LOG_FORMAT,
  GITLAB_BASE_URL,
  DASHBOARD_ENABLED,
  LOG_FILTER,
  shouldSkipAccessLogRequest,
} from "./config";
import { TransportMode } from "./types";
import { logInfo, logError, logDebug } from "./logger";
import { getSessionManager } from "./session-manager";

// OAuth imports
import {
  loadOAuthConfig,
  isOAuthEnabled,
  getAuthModeDescription,
  metadataHandler,
  protectedResourceHandler,
  authorizeHandler,
  pollHandler,
  callbackHandler,
  tokenHandler,
  registerHandler,
  sessionStore,
  runWithTokenContext,
} from "./oauth/index";
// Middleware imports
import { oauthAuthMiddleware, rateLimiterMiddleware } from "./middleware/index";

// Dashboard imports
import { dashboardHandler } from "./dashboard/index.js";

// Request logging utilities
import { getRequestContext, getIpAddress } from "./utils/request-logger";

// Condensed access logging
import {
  getRequestTracker,
  getConnectionTracker,
  runWithRequestContextAsync,
} from "./logging/index";

/**
 * Send a tools/list_changed notification to ALL connected clients.
 *
 * This notifies clients that the available tools have changed, prompting them
 * to re-fetch the tool list. Used when switching presets that affect tool availability.
 *
 * Broadcasts to all active sessions managed by the SessionManager.
 */
export async function sendToolsListChangedNotification(): Promise<void> {
  try {
    const sessionManager = getSessionManager();
    await sessionManager.broadcastToolsListChanged();
  } catch (error: unknown) {
    logError("Failed to broadcast tools/list_changed notification", { err: error });
  }
}

// Terminal colors for logging (currently unused)
// const colorGreen = '\x1b[32m';
// const colorReset = '\x1b[0m';

/**
 * Register OAuth endpoints on an Express app
 *
 * Adds:
 * - /.well-known/oauth-authorization-server - OAuth metadata
 * - /.well-known/oauth-protected-resource - Protected resource metadata (RFC 9470)
 * - /authorize - Authorization endpoint (supports both Device Flow and Authorization Code Flow)
 * - /oauth/poll - Device flow polling endpoint
 * - /oauth/callback - Authorization Code Flow callback from GitLab
 * - /token - Token exchange endpoint
 * - /health - Health check endpoint
 *
 * @param app - Express application
 */
function registerOAuthEndpoints(app: Express): void {
  // NOTE: Rate limiting is applied via rateLimiterMiddleware() BEFORE this function is called.
  // All routes registered here are protected by the global rate limiter middleware.

  // OAuth discovery metadata (no auth required)
  app.get("/.well-known/oauth-authorization-server", metadataHandler);

  // Protected Resource Metadata (RFC 9470) - required by Claude.ai custom connectors
  app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);

  // Authorization endpoint - supports both flows:
  // - Device Flow (no redirect_uri) - returns HTML page
  // - Authorization Code Flow (with redirect_uri) - redirects to GitLab
  app.get("/authorize", authorizeHandler);

  // Device flow polling endpoint (no auth required)
  app.get("/oauth/poll", pollHandler);

  // Authorization Code Flow callback from GitLab
  // GitLab redirects here after user authorizes, then we redirect to client
  app.get("/oauth/callback", callbackHandler);

  // Token endpoint - exchange code for tokens (no auth required)
  // Uses URL-encoded body as per OAuth spec
  app.post("/token", express.urlencoded({ extended: true }), tokenHandler);

  // Dynamic Client Registration endpoint (RFC 7591) - required by Claude.ai
  app.post("/register", express.json(), registerHandler);

  // NOTE: /health endpoint is registered globally in startServer() BEFORE OAuth endpoints
  // to avoid access log spam from load balancer health checks. The simple handler there
  // returns {"status": "ok"} which is sufficient for basic liveness/readiness checks.
  // For structured MCP metadata (version, tools, auth mode, instances), use GET /
  // with Accept: application/json header (dashboard endpoint).

  logInfo("OAuth endpoints registered");
}

/**
 * Check if TLS/HTTPS is enabled via SSL certificate configuration
 */
function isTLSEnabled(): boolean {
  return !!(SSL_CERT_PATH && SSL_KEY_PATH);
}

/**
 * Load TLS options from certificate files
 */
function loadTLSOptions(): https.ServerOptions | undefined {
  if (!SSL_CERT_PATH || !SSL_KEY_PATH) {
    return undefined;
  }

  try {
    const options: https.ServerOptions = {
      cert: fs.readFileSync(SSL_CERT_PATH),
      key: fs.readFileSync(SSL_KEY_PATH),
    };

    if (SSL_CA_PATH) {
      options.ca = fs.readFileSync(SSL_CA_PATH);
      logInfo("CA certificate loaded", { path: SSL_CA_PATH });
    }

    if (SSL_PASSPHRASE) {
      options.passphrase = SSL_PASSPHRASE;
    }

    logInfo("TLS certificates loaded", { path: SSL_CERT_PATH });
    return options;
  } catch (error: unknown) {
    logError("Failed to load TLS certificates", { err: error });
    throw new Error(`Failed to load TLS certificates: ${String(error)}`);
  }
}

/**
 * Configure Express trust proxy setting for reverse proxy deployments
 */
function configureTrustProxy(app: Express): void {
  if (!TRUST_PROXY) {
    return;
  }

  // Parse trust proxy value
  let trustValue: boolean | string | number = TRUST_PROXY;
  if (TRUST_PROXY === "true" || TRUST_PROXY === "1") {
    trustValue = true;
  } else if (TRUST_PROXY === "false" || TRUST_PROXY === "0") {
    trustValue = false;
  } else if (!isNaN(Number(TRUST_PROXY))) {
    trustValue = Number(TRUST_PROXY);
  }

  app.set("trust proxy", trustValue);
  logInfo("Trust proxy configured", { trustValue: String(trustValue) });
}

/**
 * Configure HTTP server timeouts for SSE streaming through proxy chains.
 *
 * - keepAliveTimeout: Time to keep idle HTTP/1.1 connections open between requests.
 *   Must exceed upstream proxy timeouts (Cloudflare max is 600s for Enterprise).
 * - headersTimeout: Must be greater than keepAliveTimeout per Node.js docs.
 * - timeout: Set to 0 to disable socket timeout entirely for long-lived SSE streams.
 */
function configureServerTimeouts(server: http.Server | https.Server): void {
  server.keepAliveTimeout = HTTP_KEEPALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_KEEPALIVE_TIMEOUT_MS + 5000; // Must be > keepAliveTimeout
  server.timeout = 0; // No socket timeout for SSE streaming

  logInfo("HTTP server timeouts configured for SSE streaming", {
    keepAliveTimeout: server.keepAliveTimeout,
    headersTimeout: server.headersTimeout,
    timeout: server.timeout,
  });
}

/**
 * Start an HTTP or HTTPS server based on TLS configuration
 */
function startHttpServer(app: Express, callback: () => void): void {
  const tlsOptions = loadTLSOptions();

  if (tlsOptions) {
    const httpsServer = https.createServer(tlsOptions, app as http.RequestListener);
    configureServerTimeouts(httpsServer);
    httpsServer.listen(Number(PORT), HOST, callback);
  } else {
    const httpServer = http.createServer(app as http.RequestListener);
    configureServerTimeouts(httpServer);
    httpServer.listen(Number(PORT), HOST, callback);
  }
}

/**
 * Get the protocol prefix for URLs
 */
function getProtocol(): string {
  return isTLSEnabled() ? "https" : "http";
}

/**
 * Start SSE heartbeat on a response to keep the connection alive through proxies.
 *
 * Sends SSE comment lines (`: ping\n\n`) at regular intervals. These are ignored
 * by SSE clients per the spec but prevent intermediate proxies (Cloudflare, Envoy)
 * from killing idle connections.
 *
 * @param res - The HTTP response with an active SSE stream
 * @param sessionId - Session identifier for logging
 * @returns Cleanup function to stop the heartbeat
 */
function startSseHeartbeat(res: express.Response, sessionId: string): () => void {
  const interval = setInterval(() => {
    try {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      } else {
        clearInterval(interval);
      }
    } catch {
      clearInterval(interval);
    }
  }, SSE_HEARTBEAT_MS);

  logDebug("SSE heartbeat started", { sessionId, intervalMs: SSE_HEARTBEAT_MS });

  return () => {
    clearInterval(interval);
    logDebug("SSE heartbeat stopped", { sessionId });
  };
}

function determineTransportMode(): TransportMode {
  const args = process.argv.slice(2);

  logInfo("Transport mode detection", { args, PORT });

  // Check for explicit stdio mode first
  if (args.includes("stdio")) {
    logInfo("Selected stdio mode (explicit argument)");
    return "stdio" as TransportMode;
  }

  // If PORT environment variable is present, start in dual transport mode (SSE + StreamableHTTP)
  if (process.env.PORT) {
    logInfo(
      "Selected dual transport mode (SSE + StreamableHTTP) - PORT environment variable detected"
    );
    return "dual" as TransportMode;
  }

  // Default to stdio mode when no PORT is specified
  logInfo("Selected stdio mode (no PORT environment variable)");
  return "stdio" as TransportMode;
}

export async function startServer(): Promise<void> {
  // Detect configuration based on auth mode
  const oauthConfig = loadOAuthConfig();
  if (oauthConfig) {
    logInfo("Starting in OAuth mode (per-user authentication)");
    logInfo("OAuth client ID configured", { clientId: oauthConfig.gitlabClientId });
  } else if (process.env.GITLAB_TOKEN) {
    // Static token mode with token configured
    logInfo("Starting in static token mode (shared GITLAB_TOKEN)");
  } else {
    // Graceful startup without token - server will accept tools/list requests
    // but tool calls will return clear errors until token is configured
    logInfo(
      "Starting without authentication - tools/list will work, but tool calls require GITLAB_TOKEN"
    );
  }

  logInfo("Authentication mode", { mode: getAuthModeDescription() });

  // Initialize session store (required for file-based and PostgreSQL persistence)
  if (oauthConfig) {
    await sessionStore.initialize();
  }

  // Initialize session manager (handles per-session Server instances)
  const sessionManager = getSessionManager();
  sessionManager.start();

  // Initialize access logging based on LOG_FORMAT
  const requestTracker = getRequestTracker();
  const connectionTracker = getConnectionTracker();
  const useCondensedLogging = LOG_FORMAT === "condensed";
  requestTracker.setEnabled(useCondensedLogging);
  connectionTracker.setEnabled(useCondensedLogging);
  logInfo("Access log format", { logFormat: LOG_FORMAT });
  if (LOG_FILTER.length > 0) {
    logInfo("Access log filter rules active", { count: LOG_FILTER.length });
  }

  const transportMode = determineTransportMode();

  switch (transportMode) {
    case "stdio": {
      const transport = new StdioServerTransport();
      await sessionManager.createSession("stdio", transport);
      logInfo("GitLab MCP Server running on stdio");
      break;
    }

    case "dual": {
      logInfo("Setting up dual transport mode (SSE + StreamableHTTP)...");
      const app = express();
      app.use(express.json());

      // Configure trust proxy for reverse proxy deployments
      configureTrustProxy(app);

      // Health check endpoint for load balancers (Envoy, nginx, etc.)
      // Registered BEFORE access logging middleware to avoid log spam
      // Does not require authentication or rate limiting
      app.get("/health", (_req, res) => {
        res.status(200).json({ status: "ok" });
      });

      // Access logging middleware - tracks request lifecycle for condensed logs
      // Opens request stack on request start, closes on response finish
      // IMPORTANT: Must be registered BEFORE rate limiter to log 429 responses
      app.use((req, res, next) => {
        if (!useCondensedLogging) {
          next();
          return;
        }

        // Check if request matches any skip filter - process normally but don't log
        if (shouldSkipAccessLogRequest(req)) {
          next();
          return;
        }

        const requestId = crypto.randomUUID();
        const clientIp = getIpAddress(req);
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        // Store requestId on response for later use
        res.locals.accessLogRequestId = requestId;

        // Open request stack
        // NOTE: For new sessions (no mcp-session-id header), sessionId will be undefined
        // at this point. The session ID is generated later by StreamableHTTPServerTransport
        // and tracked via ConnectionTracker. When the session is initialized,
        // requestTracker.setSessionIdForCurrentRequest(...) associates the new session ID
        // with this request's stack, so even the first request that creates a session
        // will have session info reflected in the access log. Connection stats are tracked
        // separately.
        requestTracker.openStack(requestId, clientIp, req.method, req.path, sessionId);

        // Close stack when response finishes
        res.on("finish", () => {
          requestTracker.closeStack(requestId, res.statusCode);
        });

        // Handle aborted requests and normal teardown of long-lived streaming/SSE responses.
        // NOTE: Both 'finish' and 'close' may fire. If 'finish' fires first,
        // the stack is removed from the map, so any subsequent close handling
        // becomes a no-op. This is safe - RequestTracker.closeStack removes
        // the stack immediately to prevent duplicate processing.
        res.on("close", () => {
          if (res.writableFinished) {
            // Response has already finished and been logged.
            return;
          }

          if (!res.headersSent) {
            // Connection closed before we could send any headers: treat as abort.
            requestTracker.closeStackWithError(requestId, "connection_closed");
            return;
          }

          // Headers were sent but the stream ended without 'finish' firing.
          // This is typical for long-lived streaming/SSE responses where the
          // client disconnects. Treat as a normal completion and log using
          // the current status code instead of an error status.
          requestTracker.closeStack(requestId, res.statusCode);
        });

        next();
      });

      // Rate limiting middleware (protects anonymous requests, authenticated users skip)
      app.use(rateLimiterMiddleware());

      // Register OAuth endpoints if OAuth mode is enabled
      if (isOAuthEnabled()) {
        registerOAuthEndpoints(app);
      }

      // Dashboard endpoint (serves HTML or JSON based on Accept header)
      // Only handles GET requests; POST requests fall through to MCP transport
      // Can be disabled via DASHBOARD_ENABLED=false
      if (DASHBOARD_ENABLED) {
        app.get("/", dashboardHandler);
        logInfo("Dashboard enabled at GET /");
      }

      // Middleware to ensure Accept header includes text/event-stream for MCP endpoints
      // This fixes compatibility with clients that don't send the full Accept header
      // as required by MCP spec (e.g., when headers are modified by reverse proxies)
      app.use(["/", "/mcp"], (req, res, next) => {
        const accept = req.headers.accept ?? "";
        if (req.method === "POST" && !accept.includes("text/event-stream")) {
          // Add text/event-stream to Accept header for POST requests
          req.headers.accept = accept
            ? `${accept}, text/event-stream`
            : "application/json, text/event-stream";
          logDebug("Modified Accept header for MCP compatibility", {
            originalAccept: accept,
            newAccept: req.headers.accept,
          });
        }
        next();
      });

      // OAuth authentication middleware for MCP endpoints (when OAuth mode is enabled)
      // Returns 401 with WWW-Authenticate header if no valid token, triggering OAuth flow
      if (isOAuthEnabled()) {
        app.use(["/", "/mcp"], oauthAuthMiddleware);
      }

      // Transport storage for both SSE and StreamableHTTP
      const sseTransports: { [sessionId: string]: SSEServerTransport } = {};
      const streamableTransports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

      // SSE Transport Endpoints (backwards compatibility)
      app.get("/sse", async (req, res) => {
        logDebug("SSE endpoint hit!");
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        const clientIp = getIpAddress(req);

        // Update request stack with SSE session ID (middleware has no session ID for initial GET)
        const accessLogRequestId = res.locals?.accessLogRequestId as string | undefined;
        if (accessLogRequestId) {
          requestTracker.setSessionId(accessLogRequestId, sessionId);
        }

        try {
          // Each SSE session gets its own Server instance
          await sessionManager.createSession(sessionId, transport);
          sseTransports[sessionId] = transport;
          logDebug("SSE transport created with session", { sessionId });

          // Track connection for access logging
          connectionTracker.openConnection(sessionId, clientIp);
          // Count the initial GET /sse request that established this connection
          connectionTracker.incrementRequests(sessionId);
        } catch (error: unknown) {
          logError("Failed to create SSE session", { err: error, sessionId });
          if (!res.headersSent) {
            res.status(500).end();
          }
          return;
        }

        // Start SSE heartbeat to keep connection alive through proxies
        const stopHeartbeat = startSseHeartbeat(res, sessionId);

        // Clean up session when client disconnects
        res.on("close", () => {
          stopHeartbeat();
          delete sseTransports[sessionId];

          // Log connection close
          connectionTracker.closeConnection(sessionId, "client_disconnect");

          sessionManager.removeSession(sessionId).catch((error: unknown) => {
            logDebug("Error removing SSE session on disconnect", { err: error, sessionId });
          });
        });
      });

      app.post("/messages", async (req, res): Promise<void> => {
        logDebug("SSE messages endpoint hit!");
        const sessionId = req.query.sessionId as string;

        if (!sessionId || !sseTransports[sessionId]) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        // Increment request count for connection tracking (SSE mode)
        connectionTracker.incrementRequests(sessionId);

        // Get access log request ID from middleware (res.locals may be undefined in tests)
        const accessLogRequestId = res.locals?.accessLogRequestId as string | undefined;

        // Update request stack with SSE session ID (middleware uses header, SSE uses query param)
        if (accessLogRequestId) {
          requestTracker.setSessionId(accessLogRequestId, sessionId);
        }

        try {
          sessionManager.touchSession(sessionId);
          const transport = sseTransports[sessionId];

          // Wrap in request context for access logging so handlers can track tool calls
          const doHandle = async () => {
            await transport.handlePostMessage(req, res, req.body);
          };

          if (accessLogRequestId) {
            await runWithRequestContextAsync(accessLogRequestId, doHandle);
          } else {
            await doHandle();
          }
        } catch (error: unknown) {
          logError("Error handling SSE message", { err: error });
          if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" });
          }
        }
      });

      // StreamableHTTP Transport Endpoint (modern, supports both GET SSE and POST JSON-RPC)
      // Also mounted at "/" for Claude.ai custom connector compatibility
      app.all(["/", "/mcp"], async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string;
        const accessLogRequestId = res.locals.accessLogRequestId as string | undefined;
        const clientIp = getIpAddress(req);

        // Get OAuth token info from middleware (stored in res.locals)
        const oauthSessionId = res.locals.oauthSessionId as string | undefined;
        const gitlabToken = res.locals.gitlabToken as string | undefined;
        const gitlabUserId = res.locals.gitlabUserId as number | undefined;
        const gitlabUsername = res.locals.gitlabUsername as string | undefined;
        const gitlabApiUrl = res.locals.gitlabApiUrl as string | undefined;
        const instanceLabel = res.locals.instanceLabel as string | undefined;

        // Get full request context for logging (verbose mode)
        if (!useCondensedLogging) {
          const requestContext = getRequestContext(req, res);
          logInfo("MCP endpoint request received", {
            event: "mcp_request",
            ...requestContext,
            hasToken: !!gitlabToken,
          });
        }

        // Helper to handle request with proper token and request contexts
        const handleWithContext = async (
          transport: StreamableHTTPServerTransport
        ): Promise<void> => {
          // Wrap in request context for access logging
          const doHandle = async () => {
            if (gitlabToken && oauthSessionId && gitlabUserId && gitlabUsername) {
              // Wrap transport.handleRequest in token context so MCP handlers have access
              await runWithTokenContext(
                {
                  gitlabToken,
                  gitlabUserId,
                  gitlabUsername,
                  sessionId: oauthSessionId,
                  apiUrl: gitlabApiUrl ?? GITLAB_BASE_URL,
                  instanceLabel,
                },
                async () => {
                  await transport.handleRequest(req, res, req.body);
                }
              );
            } else {
              // No OAuth token - direct handling (static token mode or unauthenticated)
              await transport.handleRequest(req, res, req.body);
            }
          };

          // If we have a request ID for access logging, wrap with context
          if (accessLogRequestId) {
            await runWithRequestContextAsync(accessLogRequestId, doHandle);
          } else {
            await doHandle();
          }
        };

        try {
          let transport: StreamableHTTPServerTransport;
          let effectiveSessionId: string;

          if (sessionId && sessionId in streamableTransports) {
            effectiveSessionId = sessionId;
            sessionManager.touchSession(sessionId);

            // Increment request count for connection tracking
            connectionTracker.incrementRequests(sessionId);

            transport = streamableTransports[sessionId];
            await handleWithContext(transport);
          } else {
            // Pre-generate session ID so we can connect the Server before handling the request
            const newSessionId = crypto.randomUUID();
            effectiveSessionId = newSessionId;

            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => newSessionId,
              onsessioninitialized: (initializedSessionId: string) => {
                streamableTransports[initializedSessionId] = transport;
                logInfo("MCP session initialized", {
                  sessionId: initializedSessionId,
                  method: req.method,
                });

                // Track connection for access logging
                connectionTracker.openConnection(initializedSessionId, clientIp);
                // Count the initial request that created this session
                connectionTracker.incrementRequests(initializedSessionId);

                // Update the current request stack with the newly assigned session ID
                // so that access log shows the session and tool counting works
                requestTracker.setSessionIdForCurrentRequest(initializedSessionId);

                // Associate MCP session with OAuth session if authenticated
                if (oauthSessionId) {
                  sessionStore.associateMcpSession(initializedSessionId, oauthSessionId);
                }
              },
              onsessionclosed: (closedSessionId: string) => {
                delete streamableTransports[closedSessionId];
                sessionStore.removeMcpSessionAssociation(closedSessionId);

                // Log connection close
                connectionTracker.closeConnection(closedSessionId, "client_disconnect");

                sessionManager.removeSession(closedSessionId).catch((err: unknown) => {
                  logDebug("Error removing closed session", { err, sessionId: closedSessionId });
                });
                logInfo("MCP session closed", { sessionId: closedSessionId });
              },
            });

            // Connect per-session Server BEFORE handling request — ensures
            // message routing is ready before the transport processes the request
            await sessionManager.createSession(newSessionId, transport);

            await handleWithContext(transport);
          }

          // Start SSE heartbeat for GET requests (long-lived SSE streams)
          if (req.method === "GET" && !res.writableEnded) {
            const stopHeartbeat = startSseHeartbeat(res, effectiveSessionId);
            res.on("close", () => {
              stopHeartbeat();
            });
          }
        } catch (error: unknown) {
          logError("Error in StreamableHTTP transport", { err: error });
          if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" });
          }
        }
      });

      startHttpServer(app, () => {
        const url = `${getProtocol()}://${HOST}:${PORT}`;
        logInfo("GitLab MCP Server running", { url });
        if (isTLSEnabled()) {
          logInfo("TLS/HTTPS enabled");
        }
        logInfo("Dual Transport Mode Active");
        logInfo("SSE endpoint", { endpoint: `${url}/sse`, note: "backwards compatibility" });
        logInfo("StreamableHTTP endpoint", {
          endpoint: `${url}/mcp`,
          note: "modern, supports SSE + JSON-RPC",
        });
        if (isOAuthEnabled()) {
          logInfo("OAuth Mode Active");
          logInfo("OAuth metadata", { endpoint: `${url}/.well-known/oauth-authorization-server` });
          logInfo("Authorization endpoint", { endpoint: `${url}/authorize` });
          logInfo("Token exchange endpoint", { endpoint: `${url}/token` });
        }
        logInfo("SSE keepalive configured for proxy chain compatibility", {
          heartbeatMs: SSE_HEARTBEAT_MS,
          keepAliveTimeoutMs: HTTP_KEEPALIVE_TIMEOUT_MS,
        });
        logInfo("Clients can use either transport as needed");
      });
      break;
    }
  }
}

// Graceful shutdown - close all sessions and save to storage backend before exit
async function gracefulShutdown(signal: string): Promise<void> {
  logInfo("Shutting down GitLab MCP Server...", { signal });

  // Close all tracked connections with server_shutdown reason
  try {
    const connTracker = getConnectionTracker();
    connTracker.closeAllConnections("server_shutdown");
    logInfo("All connections closed for shutdown");
  } catch (error) {
    logError("Error closing connections", { err: error as Error });
  }

  try {
    // Shut down session manager (closes all per-session Server instances)
    const sm = getSessionManager();
    await sm.shutdown();
    logInfo("Session manager shut down successfully");
  } catch (error) {
    logError("Error shutting down session manager", { err: error as Error });
  }

  try {
    // Close session store (saves file-based sessions, disconnects PostgreSQL)
    await sessionStore.close();
    logInfo("Session store closed successfully");
  } catch (error) {
    logError("Error closing session store", { err: error as Error });
  }

  process.exit(0);
}

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch(err => {
    logError("Error during graceful shutdown", { err });
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(err => {
    logError("Error during graceful shutdown", { err });
    process.exit(1);
  });
});
