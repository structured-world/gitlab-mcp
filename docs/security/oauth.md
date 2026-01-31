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

1. **GitLab 17.1+** (Device Authorization Grant support)
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

### Step 2: Configure Server

```bash
# Required for OAuth mode
OAUTH_ENABLED=true
OAUTH_SESSION_SECRET=your-minimum-32-character-secret-key
GITLAB_OAUTH_CLIENT_ID=your-gitlab-application-id
GITLAB_API_URL=https://your-gitlab-instance.com

# Server configuration
PORT=3000
HOST=0.0.0.0

# Optional OAuth settings
GITLAB_OAUTH_CLIENT_SECRET=your-secret    # Required only if GitLab app is confidential
GITLAB_OAUTH_SCOPES=api,read_user          # Default scopes
OAUTH_TOKEN_TTL=3600                       # Token lifetime (seconds)
OAUTH_REFRESH_TOKEN_TTL=604800             # Refresh token lifetime (seconds)
OAUTH_DEVICE_POLL_INTERVAL=5               # Device flow poll interval (seconds)
OAUTH_DEVICE_TIMEOUT=300                   # Auth timeout (seconds)
```

### Step 3: Deploy with HTTPS

OAuth requires HTTPS. Example with Docker:

```bash
docker run -d \
  --name gitlab-mcp \
  -e OAUTH_ENABLED=true \
  -e OAUTH_SESSION_SECRET="$(openssl rand -base64 32)" \
  -e GITLAB_OAUTH_CLIENT_ID=your-app-id \
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

## Endpoints

When OAuth is enabled:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/oauth-authorization-server` | GET | OAuth metadata discovery |
| `/.well-known/oauth-protected-resource` | GET | Protected resource metadata (RFC 9470) |
| `/authorize` | GET | Start authorization (auto-selects flow) |
| `/oauth/callback` | GET | GitLab callback (Auth Code Flow only) |
| `/oauth/poll` | GET | Poll for completion (Device Flow only) |
| `/token` | POST | Exchange code for tokens |
| `/register` | POST | Dynamic Client Registration (RFC 7591) |
| `/health` | GET | Health check |

## Troubleshooting

**"OAuth not configured" error**
- Ensure `OAUTH_ENABLED=true` is set
- Verify `OAUTH_SESSION_SECRET` is at least 32 characters
- Check `GITLAB_OAUTH_CLIENT_ID` is correct

**Device code not accepted**
- Verify GitLab version is 17.1 or later
- Check OAuth application scopes include `api`
- Ensure the application is not set as "Confidential"

**"Failed to refresh token" error**
- GitLab refresh token may have expired
- Re-authenticate through Claude connector settings

**Cannot reach GitLab for authentication**
- For private LAN GitLab, connect to VPN first
- Verify you can access GitLab web UI in your browser
