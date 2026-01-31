---
title: Docker Compose
description: "Deploy GitLab MCP Server with Docker Compose — full stack with PostgreSQL and TLS termination"
head:
  - - meta
    - name: keywords
      content: gitlab mcp docker compose, postgresql, tls termination, production deployment, oauth, backup restore, self-hosted
---

# Docker Compose

All-in-one production deployment with GitLab MCP, PostgreSQL, and optional HTTPS — managed via a single `docker-compose.yml`.

## When to Use

- Production deployments where you want everything bundled
- Teams without existing PostgreSQL infrastructure
- Quick setup of OAuth-enabled multi-instance server
- Self-contained deployments with easy backup

## Quick Start

### 1. Generate Configuration

```bash
npx @structured-world/gitlab-mcp docker init
```

Select "compose-bundle" when prompted for deployment type.

### 2. Start Services

```bash
cd ~/.config/gitlab-mcp
docker compose up -d
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

## docker-compose.yml

```yaml
services:
  gitlab-mcp:
    image: ghcr.io/structured-world/gitlab-mcp:latest
    restart: unless-stopped
    ports:
      - "3333:3002"
    environment:
      - PORT=3002
      - HOST=0.0.0.0
      - DATABASE_URL=postgresql://gitlab_mcp:${POSTGRES_PASSWORD}@postgres:5432/gitlab_mcp
      - OAUTH_SESSION_SECRET=${SESSION_SECRET}
      - GITLAB_API_URL=${GITLAB_API_URL:-https://gitlab.com}
      - GITLAB_TOKEN=${GITLAB_TOKEN}
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_DB=gitlab_mcp
      - POSTGRES_USER=gitlab_mcp
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gitlab_mcp"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

## .env File

Create a `.env` file alongside docker-compose.yml:

```bash
# Required
POSTGRES_PASSWORD=your_secure_database_password
SESSION_SECRET=your_64_char_hex_secret
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx

# Optional
GITLAB_API_URL=https://gitlab.com

# OAuth (optional)
OAUTH_CLIENT_ID=your_app_id
OAUTH_CLIENT_SECRET=your_app_secret
OAUTH_REDIRECT_URI=http://localhost:3333/oauth/callback
```

Generate a session secret:

```bash
openssl rand -hex 32
```

## Management

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f gitlab-mcp

# Update to latest
docker compose pull
docker compose up -d

# Reset database (destructive)
docker compose down -v
docker compose up -d
```

Or use the GitLab MCP CLI:

```bash
gitlab-mcp docker status
gitlab-mcp docker upgrade
gitlab-mcp docker logs -f
```

## Adding GitLab Instances

```bash
gitlab-mcp docker add-instance gitlab.company.com
```

## Backup

### Database

```bash
docker compose exec postgres pg_dump -U gitlab_mcp gitlab_mcp > backup.sql
```

### Restore

```bash
docker compose exec -T postgres psql -U gitlab_mcp gitlab_mcp < backup.sql
```

### Full Backup

```bash
# Stop services
docker compose down

# Backup volume
docker run --rm -v gitlab-mcp_pgdata:/data -v $(pwd):/backup alpine \
  tar czf /backup/pgdata-backup.tar.gz /data

# Restart
docker compose up -d
```

## HTTPS

For production deployments with HTTPS, add a reverse proxy:

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - ./certs:/etc/nginx/certs
    depends_on:
      - gitlab-mcp
```

Or see [TLS Configuration](/advanced/tls) for native TLS support.

## See Also

- [Docker standalone](/deployment/docker-standalone) — simpler setup without PostgreSQL
- [Docker + PostgreSQL](/deployment/docker-postgres) — use existing PostgreSQL
- [OAuth Authentication](/security/oauth)
- [Docker CLI commands](/cli/docker)
