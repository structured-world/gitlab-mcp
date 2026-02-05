---
title: Windsurf IDE Integration
description: "Step-by-step guide to configure GitLab MCP Server with Windsurf IDE. Enable Cascade AI integration for GitLab workflows including merge requests, issues, and CI/CD management."
head:
  - - meta
    - name: keywords
      content: Windsurf, GitLab MCP, Cascade AI, Codeium, MCP configuration, AI IDE, GitLab workflows
---

# Windsurf IDE Integration

Configure GitLab MCP for [Windsurf](https://codeium.com/windsurf).

## Auto-Setup

```bash
npx @structured-world/gitlab-mcp install --windsurf
```

## Detection

| Method | Details |
|--------|---------|
| Type | Config directory |
| Path | `~/.codeium/windsurf/` |
| Auto-detected | Yes (when config directory exists) |

## Config File Location

| OS | Path |
|----|------|
| macOS | `~/.codeium/windsurf/mcp_config.json` |
| Windows | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` |
| Linux | `~/.codeium/windsurf/mcp_config.json` |

## Configuration

Add to your `mcp_config.json`:

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

## Remote Server

Connect to a running GitLab MCP HTTP server:

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

## Verification

1. Open Windsurf
2. Start a new AI chat session
3. GitLab tools should be available in the tools list

## Troubleshooting

- **Server not loading**: Restart Windsurf after config changes
- **Config directory missing**: Create `~/.codeium/windsurf/` if it doesn't exist
- **Invalid JSON**: Validate your config file has no syntax errors

## See Also

- [Quick Start](/guide/quick-start)
- [Configuration reference](/guide/configuration)
- [Troubleshooting](/troubleshooting/clients)
