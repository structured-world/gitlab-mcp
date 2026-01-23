# Deployment Options

Choose a deployment model based on your team size, infrastructure, and requirements.

## Comparison

| Option | Users | Persistence | OAuth | Best For |
|--------|-------|-------------|-------|----------|
| [Local stdio](/deployment/local-stdio) | Single | None | No | Personal IDE use |
| [Docker standalone](/deployment/docker-standalone) | Single/Team | None | Optional | Development, testing |
| [Docker + PostgreSQL](/deployment/docker-postgres) | Team | Yes | Yes | Production with OAuth |
| [Docker Compose](/deployment/docker-compose) | Team | Yes | Yes | All-in-one production |

## Quick Decision Guide

**Personal use with AI IDE?**
:arrow_right: [Local stdio](/deployment/local-stdio)

**Team access without OAuth?**
:arrow_right: [Docker standalone](/deployment/docker-standalone)

**Team access with OAuth and persistent sessions?**
:arrow_right: [Docker + PostgreSQL](/deployment/docker-postgres)

**Production with everything bundled?**
:arrow_right: [Docker Compose](/deployment/docker-compose)

## Transport Modes

| Mode | Protocol | Port | Endpoints | Use Case |
|------|----------|------|-----------|----------|
| stdio | Standard I/O | None | N/A | Local IDE clients |
| HTTP | StreamableHTTP + SSE | Required | `/mcp`, `/sse` | Remote/shared access |

The transport mode is determined by the `PORT` environment variable:
- **`PORT` set** — HTTP mode with dual endpoints
- **`PORT` not set** — stdio mode
- **`stdio` argument** — Force stdio mode regardless

## Setup

Use the setup wizard for guided deployment configuration:

```bash
# Interactive (choose deployment type)
npx @structured-world/gitlab-mcp setup --mode=server

# Or via docker subcommand
npx @structured-world/gitlab-mcp docker init
```

## See Also

- [Transport Modes](/guide/transport)
- [Docker CLI commands](/cli/docker)
- [TLS/HTTPS Configuration](/advanced/tls)
- [OAuth Authentication](/security/oauth)
