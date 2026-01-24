---
title: npm / npx Installation
description: "Install GitLab MCP Server via npm or run directly with npx — the fastest way to get started"
---

# npm / npx Installation

The simplest way to run GitLab MCP Server.

::: tip
For guided setup with auto-detection, use the [Setup Wizard](/guide/installation/wizard):
```bash
npx @structured-world/gitlab-mcp setup
```
:::

## npx (No Installation)

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com",
        "GITLAB_READ_ONLY_MODE": "false"
      }
    }
  }
}
```

## Yarn dlx

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "yarn",
      "args": ["dlx", "-q", "@structured-world/gitlab-mcp@latest", "stdio"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com"
      }
    }
  }
}
```

## Environment Variables

All configuration is done via environment variables. See [Configuration](/guide/configuration) for the complete reference.

### Required

| Variable | Description |
|----------|-------------|
| `GITLAB_TOKEN` | GitLab personal access token with `api` scope |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_API_URL` | GitLab instance URL | `https://gitlab.com` |
| `GITLAB_PROJECT_ID` | Default project ID | — |
| `GITLAB_ALLOWED_PROJECT_IDS` | Comma-separated allowed project IDs | — |
| `GITLAB_READ_ONLY_MODE` | Restrict to read-only tools | `false` |

## Feature Flags

Enable or disable tool groups by setting these to `true` or `false`:

```json
{
  "env": {
    "USE_LABELS": "true",
    "USE_MRS": "true",
    "USE_FILES": "true",
    "USE_VARIABLES": "true",
    "USE_WORKITEMS": "true",
    "USE_WEBHOOKS": "true",
    "USE_SNIPPETS": "true",
    "USE_INTEGRATIONS": "true",
    "USE_GITLAB_WIKI": "true",
    "USE_MILESTONE": "true",
    "USE_PIPELINE": "true",
    "USE_RELEASES": "true",
    "USE_REFS": "true",
    "USE_MEMBERS": "true",
    "USE_SEARCH": "true"
  }
}
```
