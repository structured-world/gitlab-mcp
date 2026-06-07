---
title: Docker + PostgreSQL
description: "Deploy GitLab MCP Server with external PostgreSQL for OAuth session persistence and multi-user support. Ideal for teams with existing database infrastructure and production environments."
head:
  - - meta
    - name: keywords
      content: gitlab mcp postgresql, oauth session persistence, docker postgresql, multi-user, database migration, prisma, production deployment
---

# Docker with PostgreSQL Deployment

Run GitLab MCP with an external PostgreSQL database for OAuth session persistence and multi-instance support.

::: tip PostgreSQL ships in a separate image
The default `gitlab-mcp` image uses in-memory or file storage and does **not**
include PostgreSQL (keeping it lightweight). The PostgreSQL backend lives in the
optional `gitlab-mcp-db` image, layered on top of the core image — it adds the
Prisma-based backend. Use `ghcr.io/structured-world/gitlab-mcp-db` and set
`OAUTH_STORAGE_TYPE=postgresql` to enable it.
:::

## When to Use

- Production deployments with OAuth
- Teams needing persistent user sessions
- Multi-instance GitLab configurations
- When you already have a PostgreSQL server

## Prerequisites

- Docker installed and running
- PostgreSQL server (14+) accessible from the container
- GitLab OAuth application(s) registered

## Setup

### 1. Prepare PostgreSQL

Create a database for GitLab MCP:

```sql
CREATE DATABASE gitlab_mcp;
CREATE USER gitlab_mcp WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE gitlab_mcp TO gitlab_mcp;
```

### 2. Run the Container

Use the `gitlab-mcp-db` image (it carries the PostgreSQL backend) and set
`OAUTH_STORAGE_TYPE=postgresql`:

```bash
docker run -d --name gitlab-mcp \
  -e PORT=3002 \
  -e HOST=0.0.0.0 \
  -e OAUTH_ENABLED=true \
  -e OAUTH_STORAGE_TYPE=postgresql \
  -e OAUTH_STORAGE_POSTGRESQL_URL="postgresql://gitlab_mcp:your_secure_password@db-host:5432/gitlab_mcp" \
  -e OAUTH_SESSION_SECRET="$(openssl rand -hex 32)" \
  -e GITLAB_API_URL=https://gitlab.com \
  -e OAUTH_CLIENT_ID=your_oauth_app_id \
  -p 3333:3002 \
  ghcr.io/structured-world/gitlab-mcp-db:latest
```

### 3. Configure Clients

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | Internal HTTP port |
| `OAUTH_ENABLED` | Yes | Set to `true` to enable per-user OAuth (required for the database backend) |
| `OAUTH_STORAGE_TYPE` | Yes | Set to `postgresql` to use the database backend (requires the `gitlab-mcp-db` image) |
| `OAUTH_STORAGE_POSTGRESQL_URL` | Yes | PostgreSQL connection string (`DATABASE_URL` is also accepted as a fallback) |
| `OAUTH_SESSION_SECRET` | Yes | Secret for session encryption |
| `OAUTH_CLIENT_ID` | Yes | GitLab OAuth Application ID |
| `OAUTH_CLIENT_SECRET` | No | GitLab OAuth Application Secret (only for confidential apps; PKCE public apps omit it) |
| `GITLAB_API_URL` | No | Default GitLab instance URL |

## Database Schema

The server automatically runs migrations on startup via Prisma. Tables created:

- `oauth_sessions` — Active user sessions
- `oauth_tokens` — Encrypted access/refresh tokens
- `oauth_state` — CSRF protection for OAuth flow

## Multi-Instance Support

Add multiple GitLab instances via the CLI:

```bash
gitlab-mcp docker add-instance gitlab.com
gitlab-mcp docker add-instance gitlab.company.com
```

Each instance can have its own OAuth application and default preset.

## Scaling

For high-availability deployments:

- Use a managed PostgreSQL service (RDS, Cloud SQL, etc.)
- Run multiple container replicas behind a load balancer
- Set `OAUTH_SESSION_SECRET` to the same value across all replicas
- Use sticky sessions or shared session storage

## Security Notes

- Store `OAUTH_STORAGE_POSTGRESQL_URL` and secrets in environment variables, never in docker-compose.yml
- Use a dedicated database user with minimal privileges
- Enable SSL for the PostgreSQL connection: `?sslmode=require` in the connection string
- Rotate `OAUTH_SESSION_SECRET` periodically (invalidates existing sessions)

## See Also

- [OAuth Authentication](/security/oauth)
- [Docker Compose](/deployment/docker-compose) — bundled PostgreSQL
- [TLS/HTTPS Configuration](/advanced/tls)
