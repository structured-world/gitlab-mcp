---
title: GitLab MCP Quick Start Guide
description: "Get GitLab MCP Server running with your AI agent in under a minute. Step-by-step setup using npx or Docker with feature flags, authentication tokens, and client configuration."
head:
  - - meta
    - name: keywords
      content: gitlab mcp quick start, gitlab mcp setup, npx gitlab mcp, mcp server configuration, feature flags, gitlab ai agent
howto:
  name: "How to Set Up GitLab MCP Server"
  description: "Get GitLab MCP Server running with your AI agent in under a minute"
  steps:
    - name: "Get a GitLab Token"
      text: "Create a Personal Access Token in GitLab with 'api' and 'read_user' scopes. Go to GitLab Settings > Access Tokens, create a new token with the required scopes, and copy it."
    - name: "Configure Your MCP Client"
      text: "Add the gitlab-mcp server configuration to your MCP client (Claude Desktop, VS Code, Cursor, etc.). Set GITLAB_TOKEN to your token and GITLAB_API_URL to your GitLab instance URL."
    - name: "Start Using GitLab MCP"
      text: "The server starts automatically when your MCP client connects. All default tools are enabled. You can now ask your AI agent to interact with GitLab."
---

# GitLab MCP Quick Start Guide

Get GitLab MCP Server running with your AI agent in under a minute.

::: tip Recommended
Use the [Setup Wizard](/guide/installation/wizard) for guided configuration:
```bash
npx @structured-world/gitlab-mcp setup
```
:::

## 1. Get a GitLab Token

Create a [Personal Access Token](/guide/authentication#pat) with `api` and `read_user` scopes.

::: tip First time?
See the [step-by-step authentication guide](/guide/authentication) for detailed instructions on token creation and scope selection.
:::

## 2. Configure Your MCP Client

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com"
      }
    }
  }
}
```

That's it. The server starts with all default tools enabled.

## Optional Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `GITLAB_PROJECT_ID` | Default project context | — |
| `GITLAB_READ_ONLY_MODE` | Restrict to read-only tools | `false` |
| `GITLAB_API_HEADERS_TIMEOUT_MS` | Response headers timeout in ms | `10000` |
| `GITLAB_API_BODY_TIMEOUT_MS` | Response body timeout in ms | `30000` |
| `GITLAB_API_CONNECT_TIMEOUT_MS` | TCP connect timeout in ms | `2000` |

## Feature Flags

Enable or disable tool groups:

| Flag | Default | Tools |
|------|---------|-------|
| `USE_LABELS` | `true` | Label management |
| `USE_MRS` | `true` | Merge request operations |
| `USE_FILES` | `true` | File browsing and management |
| `USE_VARIABLES` | `true` | CI/CD variables |
| `USE_WORKITEMS` | `true` | Issues, epics, tasks (GraphQL) |
| `USE_WEBHOOKS` | `true` | Webhook management |
| `USE_SNIPPETS` | `true` | Code snippets |
| `USE_INTEGRATIONS` | `true` | 50+ project integrations |
| `USE_GITLAB_WIKI` | `true` | Wiki pages |
| `USE_MILESTONE` | `true` | Milestone tracking |
| `USE_PIPELINE` | `true` | Pipeline and CI/CD jobs |
| `USE_RELEASES` | `true` | Release management |
| `USE_REFS` | `true` | Branch and tag management |
| `USE_MEMBERS` | `true` | Team member management |
| `USE_SEARCH` | `true` | Cross-project search |
| `USE_ITERATIONS` | `true` | Iteration planning (sprints) |

## Next Steps

- [Setup Wizard](/guide/installation/wizard) — interactive guided setup
- [Supported Clients](/clients/) — per-client configuration guides
- [Deployment Options](/deployment/) — local vs Docker vs server
- [All environment variables](/guide/configuration)
- [CLI Reference](/cli/) — all available commands
- [OAuth for teams](/security/oauth)
