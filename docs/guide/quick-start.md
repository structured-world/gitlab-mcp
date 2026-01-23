# Quick Start

Get GitLab MCP Server running with your AI agent in under a minute.

## 1. Get a GitLab Token

Create a [Personal Access Token](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html) with `api` and `read_user` scopes.

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
| `GITLAB_API_TIMEOUT_MS` | API timeout in milliseconds | `10000` |

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

## Next Steps

- [Detailed installation options](/guide/installation/npm)
- [All environment variables](/guide/configuration)
- [OAuth for teams](/security/oauth)
