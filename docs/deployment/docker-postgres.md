# Docker + PostgreSQL

Run GitLab MCP with an external PostgreSQL database for OAuth session persistence and multi-instance support.

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

```bash
docker run -d --name gitlab-mcp \
  -e PORT=3002 \
  -e HOST=0.0.0.0 \
  -e DATABASE_URL="postgresql://gitlab_mcp:your_secure_password@db-host:5432/gitlab_mcp" \
  -e OAUTH_SESSION_SECRET="$(openssl rand -hex 32)" \
  -e GITLAB_API_URL=https://gitlab.com \
  -e OAUTH_CLIENT_ID=your_oauth_app_id \
  -e OAUTH_CLIENT_SECRET=your_oauth_app_secret \
  -e OAUTH_REDIRECT_URI=http://localhost:3333/oauth/callback \
  -p 3333:3002 \
  ghcr.io/structured-world/gitlab-mcp:latest
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
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OAUTH_SESSION_SECRET` | Yes | Secret for session encryption |
| `OAUTH_CLIENT_ID` | Yes | GitLab OAuth Application ID |
| `OAUTH_CLIENT_SECRET` | Yes | GitLab OAuth Application Secret |
| `OAUTH_REDIRECT_URI` | Yes | OAuth callback URL |
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

- Store `DATABASE_URL` and secrets in environment variables, never in docker-compose.yml
- Use a dedicated database user with minimal privileges
- Enable SSL for the PostgreSQL connection: `?sslmode=require` in DATABASE_URL
- Rotate `OAUTH_SESSION_SECRET` periodically (invalidates existing sessions)

## See Also

- [OAuth Authentication](/security/oauth)
- [Docker Compose](/deployment/docker-compose) — bundled PostgreSQL
- [TLS/HTTPS Configuration](/advanced/tls)
