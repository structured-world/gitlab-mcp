---
title: Cline Integration Guide
description: "Step-by-step guide to configure GitLab MCP Server with Cline, the autonomous AI coding agent. Connect your GitLab projects for intelligent code assistance and automated workflows."
head:
  - - meta
    - name: keywords
      content: Cline, GitLab MCP, VS Code extension, AI coding agent, MCP configuration, autonomous coding
---

# Cline Integration Guide

Configure GitLab MCP for [Cline](https://github.com/cline/cline) (VS Code extension).

## Auto-Setup

```bash
npx @structured-world/gitlab-mcp install --cline
```

## Detection

| Method | Details |
|--------|---------|
| Type | Extension storage directory |
| Extension ID | `saoudrizwan.claude-dev` |
| Auto-detected | Yes (when extension storage exists) |

## Config File Location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Windows | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| Linux | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |

## Configuration

Add to your `cline_mcp_settings.json`:

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

1. Open VS Code with the Cline extension installed
2. Open the Cline panel
3. Check MCP server status in Cline settings
4. GitLab tools should appear in the available tools list

## Troubleshooting

- **Config path not found**: Install the Cline extension first, then the settings directory will be created
- **Server not connecting**: Reload VS Code window after config changes
- **Extension ID changed**: Verify the extension is `saoudrizwan.claude-dev` in your VS Code extensions

## See Also

- [Quick Start](/guide/quick-start)
- [Configuration reference](/guide/configuration)
- [Troubleshooting](/troubleshooting/clients)
