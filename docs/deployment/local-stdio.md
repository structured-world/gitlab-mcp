---
title: Local stdio
description: "Run GitLab MCP Server locally with stdio transport — simplest deployment for single-user setups"
head:
  - - meta
    - name: keywords
      content: gitlab mcp stdio, local deployment, mcp client configuration, npx, personal access token, single user
---

# Local stdio Deployment

Run GitLab MCP locally via standard I/O. The MCP client spawns the server process directly — no network, no ports, no containers.

## When to Use

- Personal use with a single AI IDE client
- Simplest possible setup
- No Docker required
- No network exposure

## Setup

### Via Setup Wizard

```bash
npx @structured-world/gitlab-mcp init
```

### Manual Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "glpat-xxxxxxxxxxxxxxxxxxxx",
        "GITLAB_API_URL": "https://gitlab.com"
      }
    }
  }
}
```

## How It Works

```
┌─────────────────┐     stdio      ┌─────────────────┐
│   MCP Client    │ ◄────────────► │  gitlab-mcp     │
│  (Claude, etc.) │   stdin/stdout │  (child process) │
└─────────────────┘                └─────────────────┘
                                          │
                                          │ HTTPS
                                          ▼
                                   ┌─────────────────┐
                                   │  GitLab API     │
                                   └─────────────────┘
```

1. MCP client starts `gitlab-mcp` as a child process
2. Communication happens via stdin/stdout (JSON-RPC)
3. The server connects to the GitLab API using the configured token

## Configuration Options

All configuration is via environment variables in the `env` object:

| Variable | Required | Description |
|----------|----------|-------------|
| `GITLAB_TOKEN` | Yes | [Personal Access Token](/guide/authentication#pat) |
| `GITLAB_API_URL` | No | GitLab instance URL (default: `https://gitlab.com`) |
| `GITLAB_PROJECT_ID` | No | Default project context |
| `GITLAB_READ_ONLY_MODE` | No | Restrict to read-only tools |

See [Configuration reference](/guide/configuration) for all options.

## Limitations

- One instance per MCP client
- No shared access between users
- No OAuth support (token-based only)
- Process lifecycle tied to the MCP client

## Alternatives

If you need multi-user access or OAuth, consider:
- [Docker standalone](/deployment/docker-standalone) — HTTP access without persistence
- [Docker Compose](/deployment/docker-compose) — Full production setup

## See Also

- [npm / npx Installation](/guide/installation/npm)
- [Supported Clients](/clients/)
- [Configuration reference](/guide/configuration)
