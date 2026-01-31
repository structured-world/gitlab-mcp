---
title: Transport Modes
description: "Choose between stdio, SSE, and StreamableHTTP transport modes for GitLab MCP Server"
head:
  - - meta
    - name: keywords
      content: gitlab mcp transport, stdio, SSE, StreamableHTTP, http mode, mcp server transport, server-sent events
---

# Transport Modes

The server automatically selects the appropriate transport mode based on configuration.

## Automatic Mode Selection

| Configuration | Transport Mode | Endpoints | Use Case |
|--------------|----------------|-----------|----------|
| `PORT` env var present | HTTP (Dual) | `/sse` and `/mcp` | Web clients, HTTP-based MCP |
| No `PORT` env var | stdio | N/A | CLI tools, direct MCP |
| `stdio` argument | stdio (forced) | N/A | Override PORT when set |

## HTTP Mode (Dual Transport)

When `PORT` is set, the server starts an Express HTTP server providing both endpoints simultaneously:

- **`/mcp`** — StreamableHTTP (recommended for modern clients)
- **`/sse`** — Server-Sent Events (backwards compatibility)

Features:
- Session management and reconnection
- Perfect for web-based MCP clients
- Supports TLS termination (direct or via reverse proxy)

## stdio Mode

Direct stdin/stdout communication:

- No HTTP server required
- Optimal for command-line tools
- Lower resource usage
- Used by most desktop MCP clients (Claude Desktop, VS Code, Cursor)

## Forcing stdio Mode

If `PORT` is set but you need stdio mode:

```bash
npx @structured-world/gitlab-mcp stdio
```

The `stdio` argument overrides the PORT environment variable.
