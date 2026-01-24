---
title: Docker Standalone
description: "Deploy GitLab MCP Server as a standalone Docker container with SSE or StreamableHTTP transport"
---

# Docker Standalone

Run GitLab MCP as a standalone Docker container with HTTP transport. No external database, no persistent state.

## When to Use

- Development and testing
- Quick team deployments
- Single GitLab instance with PAT authentication
- When you don't need OAuth session persistence

## Quick Start

```bash
docker run -d --name gitlab-mcp \
  -e PORT=3002 \
  -e GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx \
  -e GITLAB_API_URL=https://gitlab.com \
  -p 3333:3002 \
  ghcr.io/structured-world/gitlab-mcp:latest
```

## Setup via Wizard

```bash
npx @structured-world/gitlab-mcp docker init
```

Select "standalone" when prompted for deployment type.

## Client Configuration

### StreamableHTTP (Recommended)

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "streamable-http",
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

### SSE (Legacy)

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "sse",
      "url": "http://localhost:3333/sse"
    }
  }
}
```

## Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `PORT` | Yes | Internal HTTP port | — |
| `HOST` | No | Bind address | `0.0.0.0` |
| `GITLAB_TOKEN` | Yes | [GitLab Personal Access Token](/guide/authentication#pat) | — |
| `GITLAB_API_URL` | No | GitLab instance URL | `https://gitlab.com` |
| `GITLAB_READ_ONLY_MODE` | No | Restrict to read-only tools | `false` |

Feature flags (`USE_*`) are also supported. See [Configuration](/guide/configuration).

## Management

```bash
# Status
gitlab-mcp docker status

# Logs
gitlab-mcp docker logs
gitlab-mcp docker logs -f

# Lifecycle
gitlab-mcp docker stop
gitlab-mcp docker start
gitlab-mcp docker restart

# Update
gitlab-mcp docker upgrade
```

## Architecture

```
┌─────────────────┐     HTTP       ┌──────────────────┐
│   MCP Client    │ ◄────────────► │  Docker Container │
│  (any client)   │  /mcp or /sse  │  gitlab-mcp      │
└─────────────────┘                └──────────────────┘
                                          │
                                          │ HTTPS
                                          ▼
                                   ┌─────────────────┐
                                   │  GitLab API     │
                                   └─────────────────┘
```

## Limitations

- No persistent state — all sessions lost on container restart
- No OAuth — token-based authentication only
- Single token — all clients share the same GitLab identity
- No session storage — can't persist OAuth grants

## HTTPS

For HTTPS support, see [TLS Configuration](/advanced/tls).

## See Also

- [Docker + PostgreSQL](/deployment/docker-postgres) — add persistence for OAuth
- [Docker Compose](/deployment/docker-compose) — bundled production setup
- [Docker CLI commands](/cli/docker)
