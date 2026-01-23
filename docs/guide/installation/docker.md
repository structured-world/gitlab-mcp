# Docker Installation

Run GitLab MCP Server as a Docker container.

## stdio Mode

For direct MCP communication (CLI tools, Claude Desktop):

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITLAB_TOKEN",
        "-e", "GITLAB_API_URL",
        "-e", "GITLAB_READ_ONLY_MODE",
        "-e", "USE_LABELS",
        "-e", "USE_MRS",
        "-e", "USE_FILES",
        "-e", "USE_VARIABLES",
        "-e", "USE_WORKITEMS",
        "-e", "USE_WEBHOOKS",
        "-e", "USE_SNIPPETS",
        "-e", "USE_INTEGRATIONS",
        "-e", "USE_GITLAB_WIKI",
        "-e", "USE_MILESTONE",
        "-e", "USE_PIPELINE",
        "-e", "USE_RELEASES",
        "-e", "USE_REFS",
        "-e", "USE_MEMBERS",
        "-e", "USE_SEARCH",
        "ghcr.io/structured-world/gitlab-mcp:latest"
      ],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com",
        "GITLAB_READ_ONLY_MODE": "false"
      }
    }
  }
}
```

## HTTP Mode (SSE + StreamableHTTP)

When `PORT` is set, the server starts in HTTP mode with dual transport endpoints:

```bash
docker run -i --rm \
  -e PORT=3002 \
  -e GITLAB_TOKEN=your_gitlab_token \
  -e GITLAB_API_URL="https://gitlab.com" \
  -e GITLAB_READ_ONLY_MODE=true \
  -e USE_GITLAB_WIKI=true \
  -e USE_MILESTONE=true \
  -e USE_PIPELINE=true \
  -p 3333:3002 \
  ghcr.io/structured-world/gitlab-mcp:latest
```

### StreamableHTTP Client (Recommended)

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

### SSE Client (Legacy)

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

## Transport Mode Selection

| Configuration | Mode | Endpoints |
|--------------|------|-----------|
| `PORT` env var present | HTTP (Dual) | `/sse` and `/mcp` |
| No `PORT` env var | stdio | N/A |
| `stdio` argument | stdio (forced) | N/A |

## Docker Compose

```yaml
services:
  gitlab-mcp:
    image: ghcr.io/structured-world/gitlab-mcp:latest
    environment:
      - PORT=3002
      - HOST=0.0.0.0
      - GITLAB_TOKEN=${GITLAB_TOKEN}
      - GITLAB_API_URL=https://gitlab.com
    ports:
      - "3333:3002"
```

## HTTPS with Docker

See [TLS/HTTPS Configuration](/advanced/tls) for setting up secure connections with Docker.
