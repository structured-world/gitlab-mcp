---
title: Docker Issues
description: "Troubleshoot GitLab MCP Docker deployments. Fix container startup failures, port conflicts, networking issues, PostgreSQL connections, Docker Compose problems, and health check failures."
head:
  - - meta
    - name: keywords
      content: GitLab MCP Docker, container issues, networking, PostgreSQL, Docker Compose, health checks, troubleshooting
faq:
  - question: "How do I fix 'port is already allocated' error in GitLab MCP Docker?"
    answer: "Another service is using the same port. Find what's using the port with 'lsof -i :3333', then either stop that service or change the GitLab MCP port using 'docker run -e PORT=3002 -p 3334:3002' or update the ports mapping in docker-compose.yml."
  - question: "How do I fix 'no such image' error when starting GitLab MCP Docker?"
    answer: "The Docker image hasn't been pulled or the tag is incorrect. Run 'docker pull ghcr.io/structured-world/gitlab-mcp:latest' to pull the latest image, or check your image tag spelling."
  - question: "How do I view GitLab MCP Docker container logs?"
    answer: "Run 'gitlab-mcp docker logs -f' or 'docker logs -f gitlab-mcp' to view real-time container logs. Add '--tail 100' to see only the last 100 lines."
---

# Troubleshooting Docker Deployments

Problems with Docker container startup, networking, and configuration.

## Container Won't Start

### "port is already allocated"

**Cause**: Another service is using the same port.

**Fix**:
```bash
# Find what's using port 3333
lsof -i :3333

# Choose a different port
docker run -d -e PORT=3002 -p 3334:3002 ...
```

Or update your docker-compose.yml:
```yaml
ports:
  - "3334:3002"  # Change host port
```

### "no such image"

**Cause**: Image not pulled or incorrect tag.

**Fix**:
```bash
docker pull ghcr.io/structured-world/gitlab-mcp:latest
```

### Container Exits Immediately

**Cause**: Missing required environment variables or invalid configuration.

**Check logs**:
```bash
docker logs gitlab-mcp
# or
gitlab-mcp docker logs
```

Common causes:
- Missing `PORT` environment variable (required for HTTP mode)
- Invalid `DATABASE_URL` (if using PostgreSQL)
- Node.js startup errors

## Networking Issues

### "Connection refused" from Client

**Cause**: Port mapping or bind address mismatch.

**Check 1**: Container is running:
```bash
docker ps | grep gitlab-mcp
```

**Check 2**: Port mapping is correct:
```bash
# Container port (internal) must match PORT env var
# Host port must match your client config URL
docker port gitlab-mcp
```

**Check 3**: Bind address:
- `HOST=0.0.0.0` — accessible from host and network
- `HOST=127.0.0.1` — only accessible from within container

### Docker Desktop (macOS/Windows)

Docker Desktop uses a VM. Ensure port forwarding is working:
```bash
curl http://localhost:3333/mcp
```

If this fails but the container is running, check Docker Desktop settings > Resources > Network.

### Remote Access

For access from other machines, ensure:
1. `HOST=0.0.0.0` in the container
2. Firewall allows the host port
3. Client uses the server's IP/hostname, not `localhost`

## Database Issues

### "ECONNREFUSED" to PostgreSQL

**Cause**: PostgreSQL not reachable from the container.

**Fix for Docker Compose**:
- Ensure `depends_on` with health check is configured
- Use service name (`postgres`) as hostname in `DATABASE_URL`
- Wait for PostgreSQL to be healthy before gitlab-mcp starts

**Fix for external PostgreSQL**:
```bash
# Use host.docker.internal for macOS/Windows host DB
DATABASE_URL=postgresql://user:pass@host.docker.internal:5432/gitlab_mcp

# For Linux, use --network host or the host IP
docker run --network host ...
```

### Migration Errors

**Cause**: Prisma migration failed on startup.

**Fix**:
```bash
# Reset database (destructive!)
docker compose exec postgres psql -U gitlab_mcp -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose restart gitlab-mcp
```

## Docker Compose Issues

### "no configuration file provided"

**Cause**: Running `docker compose` from wrong directory.

**Fix**:
```bash
cd ~/.config/gitlab-mcp
docker compose up -d
```

Or specify the file:
```bash
docker compose -f ~/.config/gitlab-mcp/docker-compose.yml up -d
```

### Volume Permissions

If PostgreSQL fails with permission errors:

```bash
# Remove and recreate volume
docker compose down -v
docker compose up -d
```

### .env Not Loaded

Ensure `.env` is in the same directory as `docker-compose.yml`:
```bash
ls ~/.config/gitlab-mcp/.env
```

## Image Updates

### Upgrade Fails

```bash
# Manual upgrade
docker compose pull
docker compose up -d

# Or via CLI
gitlab-mcp docker upgrade
```

### Pin to Specific Version

Instead of `latest`, use a specific version:
```yaml
image: ghcr.io/structured-world/gitlab-mcp:6.35.0
```

## Resource Issues

### High Memory Usage

The container typically uses 50-150MB RAM. If higher:
- Check for memory leaks in logs
- Set resource limits:
  ```yaml
  services:
    gitlab-mcp:
      deploy:
        resources:
          limits:
            memory: 256M
  ```

### Disk Space

Docker images and volumes consume disk:
```bash
# Check Docker disk usage
docker system df

# Clean unused images
docker image prune
```

## Health Checks

Verify the server is responding:

```bash
# StreamableHTTP endpoint
curl -X POST http://localhost:3333/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"capabilities":{}}}'

# SSE endpoint
curl http://localhost:3333/sse
```

## See Also

- [Docker standalone](/deployment/docker-standalone)
- [Docker Compose](/deployment/docker-compose)
- [Docker CLI commands](/cli/docker)
- [Connection Issues](/troubleshooting/connection)
