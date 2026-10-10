---
title: OAuth Authentication
description: "Set up OAuth 2.1 authentication for GitLab MCP Server — per-user tokens via Claude Custom Connector"
head:
  - - meta
    - name: keywords
      content: GitLab OAuth, OAuth 2.1, authentication, Claude Custom Connector, device flow, MCP security
---

# OAuth Authentication

GitLab MCP Server supports OAuth 2.1 authentication for use as a **Claude Custom Connector**. This enables secure per-user authentication without sharing GitLab tokens.

## When to Use OAuth

| Scenario | Recommended Mode |
|----------|------------------|
| Personal/local use | Static Token (`GITLAB_TOKEN`) |
| Team access via Claude Web/Desktop | **OAuth Mode** |
| Private LAN GitLab with public MCP server | **OAuth Mode** |
| CI/CD or automated pipelines | Static Token |

## Prerequisites

1. **GitLab 16.0+**; the Device Flow needs GitLab 17.3+ (17.2 with the `oauth2_device_grant_flow` feature flag)
2. **HTTPS endpoint** for gitlab-mcp (required for OAuth)
3. **GitLab OAuth Application** configured

## Setup Guide

### Step 1: Create GitLab OAuth Application

1. In GitLab, navigate to **User Settings > Applications** (or **Admin > Applications** for instance-wide)
2. Create a new application:
   - **Name**: `GitLab MCP Server`
   - **Redirect URI**: `https://your-mcp-server.com/oauth/callback`
   - **Confidential**: `No` (PKCE provides security without client secret)
   - **Scopes**: Select `api` and `read_user`
3. Save and copy the **Application ID**

::: tip
The redirect URI is used by Claude.ai Custom Connectors (Authorization Code Flow). CLI clients use Device Flow which doesn't require redirect URI.
:::

::: info OAUTH_ISSUER
`OAUTH_ISSUER` is the public URL clients connect to (for example `https://your-mcp-server.com`).
It is the issuer of every token and the base of the redirect URI above
(`<OAUTH_ISSUER>/oauth/callback`). It is configuration, not derived from request headers.

The issuer may include a path when a reverse proxy serves the server under a prefix
(for example `https://example.com/gitlab`) and strips that prefix before forwarding.
Discovery documents of such an issuer live on the origin with the path after the
well-known segment (`/.well-known/oauth-authorization-server/gitlab`,
`/.well-known/oauth-protected-resource/gitlab/mcp`); route these URLs to the server too.
:::

### Step 2: Configure Server

```bash
# Required for OAuth mode
OAUTH_ENABLED=true
OAUTH_ISSUER=https://your-mcp-server.com   # Public URL clients connect to
OAUTH_SESSION_SECRET=your-minimum-32-character-secret-key
OAUTH_CLIENT_ID=your-gitlab-application-id
GITLAB_API_URL=https://your-gitlab-instance.com

# Server configuration
PORT=3000
HOST=0.0.0.0

# Optional OAuth settings
OAUTH_CLIENT_SECRET=your-secret    # Required only if GitLab app is confidential
OAUTH_SCOPES=api,read_user          # Default scopes
OAUTH_TOKEN_TTL=3600                       # Token lifetime (seconds)
OAUTH_REFRESH_TOKEN_TTL=604800             # Refresh token lifetime (seconds)
OAUTH_DEVICE_POLL_INTERVAL=5               # Minimum device flow poll interval (seconds)
OAUTH_DEVICE_TIMEOUT=300                   # Maximum device flow lifetime (seconds)
```

### Step 3: Deploy with HTTPS

OAuth requires HTTPS. Example with Docker:

```bash
docker run -d \
  --name gitlab-mcp \
  -e OAUTH_ENABLED=true \
  -e OAUTH_ISSUER=https://your-mcp-server.com \
  -e OAUTH_SESSION_SECRET="$(openssl rand -base64 32)" \
  -e OAUTH_CLIENT_ID=your-app-id \
  -e GITLAB_API_URL=https://gitlab.example.com \
  -e PORT=3000 \
  -p 3000:3000 \
  ghcr.io/structured-world/gitlab-mcp:latest
```

Use a reverse proxy (nginx, Caddy, Traefik) to add HTTPS. See [TLS/HTTPS Configuration](/advanced/tls).

## Claude Web Setup

1. Go to [claude.ai](https://claude.ai) and sign in
2. Navigate to **Settings > Connectors**
3. Click **Add custom connector**
4. Enter your gitlab-mcp server URL: `https://your-mcp-server.com`
5. Click **Add**
6. When prompted, complete authentication:
   - You'll see a device code (e.g., `ABCD-1234`)
   - Open your GitLab instance and enter the code
   - Approve the authorization request
7. The connector is now active

## Claude Desktop Setup

### macOS / Linux

Edit `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "streamable-http",
      "url": "https://your-mcp-server.com/mcp"
    }
  }
}
```

### Windows

Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "streamable-http",
      "url": "https://your-mcp-server.com/mcp"
    }
  }
}
```

After adding the server:
1. Restart Claude Desktop
2. Claude will prompt you to authenticate
3. Complete the device flow authorization in GitLab
4. Start using GitLab tools with your personal identity

## Private LAN GitLab Architecture

For GitLab instances on private networks (not internet-accessible):

```
+-------------------+         +-------------------+         +-------------------+
|   Claude Cloud    |  HTTPS  |    gitlab-mcp     |  HTTP   |   GitLab Server   |
|   or Desktop      |-------->|   (Public IP)     |-------->|   (Private LAN)   |
+-------------------+         +-------------------+         +-------------------+
                                       |
                                       | Device code displayed
                                       v
                              +-------------------+
                              |   User (on VPN)   |
                              |   visits GitLab   |
                              |   enters code     |
                              +-------------------+
```

**How it works:**
1. gitlab-mcp server has network access to GitLab (same network or VPN)
2. User connects to gitlab-mcp via Claude (public internet)
3. gitlab-mcp initiates device authorization with GitLab
4. User receives a code and visits GitLab directly (requires VPN/internal access)
5. User authenticates in GitLab and enters the code
6. gitlab-mcp receives the token and issues an MCP session token
7. All subsequent requests use the user's GitLab identity

**Requirements:**
- gitlab-mcp must reach GitLab API (deploy on same network or use VPN)
- Users must be able to access GitLab web UI (typically via VPN)
- gitlab-mcp must be accessible from internet (for Claude to connect)

## OAuth vs Static Token

| Feature | Static Token | OAuth Mode |
|---------|--------------|------------|
| Setup complexity | Simple | Moderate |
| Per-user identity | No (shared token) | Yes |
| Token management | Manual | Automatic |
| Audit trail | Single identity | Per-user actions |
| Security | Token in config | No tokens in config |
| Best for | Personal use, CI/CD | Teams, shared access |

## OAuth Flows

The server supports two OAuth flows automatically:

| Flow | Trigger | Used By | How It Works |
|------|---------|---------|--------------|
| **Authorization Code** | `redirect_uri` present | Claude.ai Custom Connectors | Redirects to GitLab OAuth, then back |
| **Device Flow** | No `redirect_uri` | CLI clients, Claude Desktop | Shows device code for manual entry |

The flow is selected automatically based on the presence of `redirect_uri` in the authorization request.

The Device Flow needs GitLab 17.3 or later (17.2 with the `oauth2_device_grant_flow` feature flag). On older instances a request without `redirect_uri` is refused with `invalid_request`; clients there use the Authorization Code flow.

### Token binding

- **Client and redirect:** the Authorization Code flow requires a client registered through `/register`, and `redirect_uri` must be one of its registered URIs; otherwise the request fails without a redirect. The Device Flow does not use a redirect and needs no registration.
- **Client authentication:** public clients (`token_endpoint_auth_method: none`) identify themselves with `client_id` and PKCE. A client registered with `client_secret_basic` or `client_secret_post` must present its secret at `/token` and `/revoke`, in the `Authorization: Basic` header or the form (never both); a wrong or missing secret gets `401 invalid_client`. Other methods are refused at registration.
- **Registrations:** a registration that never completes an authorization expires after 24 hours; a client that obtained tokens keeps its registration. One source address may register at most 100 clients per hour: further requests get `429` with `Retry-After`, and no existing registration is removed. Behind a reverse proxy set `TRUST_PROXY` so the address is the client's, not the proxy's; otherwise all clients share one limit.
- **Resource:** clients may send `resource` (RFC 8707) naming `<OAUTH_ISSUER>` or `<OAUTH_ISSUER>/mcp`; any other value fails with `invalid_target`. Access tokens carry that resource as `aud` (`<OAUTH_ISSUER>/mcp` when none was requested) and `OAUTH_ISSUER` as `iss`; both are checked on every request.
- **Scope:** supported scopes are `mcp:tools` and `mcp:resources`; unknown values are ignored and no recognised value grants both. Tool calls require `mcp:tools`. A refresh may narrow the scope, never widen it.
- **Transports:** every MCP transport requires the access token in OAuth mode, including the legacy SSE endpoints (`/sse`, `/messages`).
- **Codes and refresh:** an authorization code is consumed on first use, and both grants require the `client_id` the code or refresh token was issued to.
- **Issuer identification:** every redirect back to the client carries `iss` (RFC 9207).

### Choosing a GitLab instance

Users sign in to an operator-configured instance only: the default `GITLAB_API_URL` with `OAUTH_CLIENT_ID`, plus every instance in `GITLAB_INSTANCES` / `GITLAB_INSTANCES_FILE` that has its own `oauth` application. When more than one is available, `/authorize` shows a page to choose one; a client may also pass `instance=<instance URL>`. A URL that is not one of the configured instances is rejected, so credentials are never sent to an arbitrary host.

The chosen instance and its application are used for the whole account: authorization, code exchange, user lookup and every token refresh. Each instance's GitLab application registers the same redirect URI, `<OAUTH_ISSUER>/oauth/callback`. Instances with a base path (for example `https://git.example.com/gitlab`) are supported. If an instance is removed from the configuration, its accounts must sign in again; they are never moved to another instance.

### Disconnecting and recovery

- **Disconnect:** a client revokes its access or refresh token at `/revoke` (RFC 7009, `client_id` required). The session ends on every replica and the linked GitLab token is revoked as well.
- **Denied consent:** the client receives `error=access_denied` (with `state` and `iss`) and can start again.
- **Expired or revoked GitLab authorization:** requests get `401 invalid_token` and tool results carry a reconnect challenge.
- **Missing GitLab scope:** a GitLab `403 insufficient_scope` produces a tool result challenge with `error="insufficient_scope"`.
- **Instance removed from the configuration:** its accounts must sign in again; they are never moved to another instance.
- **Storage outage:** requests answer `503`, so clients retry instead of discarding valid credentials.

Access and refresh tokens, GitLab tokens and application secrets never appear in logs, tool results or diagnostics.

### Account profile

The read-only `get_profile` tool takes no input and returns the account behind the connection: an opaque `id`, the GitLab display `name` and `email` when GitLab provides them, and a `nickname` of the form `<username> @ <instance>`. The `id` is derived from the instance and the GitLab user id, so it stays the same across token refresh and reconnects and differs for the same user id on different instances. The tool is marked with `_meta["openai/profile"]` so hosts can label each connection.

### Reconnecting an account

In OAuth mode every tool descriptor declares `securitySchemes: [{ "type": "oauth2", "scopes": ["mcp:tools"] }]` (mirrored in `_meta`). When GitLab rejects the account's credentials (HTTP 401), the tool result is an error carrying `_meta["mcp/www_authenticate"]` with a `Bearer` challenge (`error="invalid_token"` and an `error_description`) that points at the protected resource metadata, so the client starts its own reconnect flow. HTTP 401 responses carry the same `error` parameters for rejected tokens.

## Endpoints

When OAuth is enabled:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/oauth-authorization-server` | GET | OAuth metadata discovery |
| `/.well-known/oauth-protected-resource` | GET | Protected resource metadata (RFC 9470) |
| `/.well-known/oauth-protected-resource/mcp` | GET | Protected resource metadata of the `/mcp` endpoint (RFC 9728) |
| `/authorize` | GET | Start authorization (auto-selects flow) |
| `/oauth/callback` | GET | GitLab callback (Auth Code Flow only) |
| `/oauth/poll` | GET | Poll for completion (Device Flow only) |
| `/token` | POST | Exchange code for tokens |
| `/register` | POST | Dynamic Client Registration (RFC 7591) |
| `/revoke` | POST | Token revocation (RFC 7009): disconnects the account |
| `/health` | GET | Health check |

## Troubleshooting

**"OAuth not configured" error**
- Ensure `OAUTH_ENABLED=true` is set
- Verify `OAUTH_SESSION_SECRET` is at least 32 characters
- Check `OAUTH_CLIENT_ID` is correct

**Device code not accepted**
- Verify GitLab version is 17.3 or later (17.2 with the `oauth2_device_grant_flow` feature flag)
- Check OAuth application scopes include `api`
- Ensure the application is not set as "Confidential"

**"Failed to refresh token" error**
- GitLab refresh token may have expired
- Re-authenticate through Claude connector settings

**Cannot reach GitLab for authentication**
- For private LAN GitLab, connect to VPN first
- Verify you can access GitLab web UI in your browser
