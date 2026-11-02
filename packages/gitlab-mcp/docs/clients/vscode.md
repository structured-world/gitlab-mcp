---
title: VS Code Integration Guide
description: "Step-by-step guide to configure GitLab MCP Server with VS Code. Enable GitHub Copilot integration for AI-assisted GitLab workflows including merge requests and CI/CD management."
head:
  - - meta
    - name: keywords
      content: VS Code, GitLab MCP, GitHub Copilot, MCP extension, Visual Studio Code, GitLab integration
---

# VS Code Integration Guide

Configure GitLab MCP for [VS Code](https://code.visualstudio.com/) with GitHub Copilot's MCP support.

## Auto-Setup

```bash
npx @structured-world/gitlab-mcp install --vscode
```

## One-Click Install

Install directly from VS Code:

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-0078d4?logo=visual-studio-code)](vscode:mcp/install?%7B%22name%22%3A%22gitlab%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)

## Detection

| Method | Details |
|--------|---------|
| Type | Config directory |
| Path | `.vscode/` (per-project) |
| Auto-detected | Yes (when `.vscode/` directory exists) |

## Config File Location

| OS | Path |
|----|------|
| All | `.vscode/mcp.json` (per-project) |

::: tip
Use `.vscode/mcp.json` for workspace configuration. VS Code also supports user-level
MCP configuration through its MCP configuration commands.
:::

## Configuration

Create or edit `.vscode/mcp.json` in your project root:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "gitlab-token",
      "description": "GitLab access token",
      "password": true
    }
  ],
  "servers": {
    "gitlab": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "${input:gitlab-token}",
        "GITLAB_API_URL": "https://gitlab.com"
      }
    }
  }
}
```

VS Code prompts for the token without writing its value into this workspace file.
Do not replace the input reference with a literal token in a committed configuration.

## Remote Server

Connect to a running GitLab MCP HTTP server:

```json
{
  "servers": {
    "gitlab": {
      "type": "http",
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

These examples use the VS Code `.vscode/mcp.json` format with a `servers` root.
Portable Copilot configurations use `mcpServers` instead; do not interchange the
formats when selecting a different configuration destination.
See [Microsoft's MCP server guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## Verification

1. Open the project in VS Code
2. Open GitHub Copilot chat
3. Check available MCP tools via the tools picker
4. GitLab tools should be listed

## Troubleshooting

- **Tools not appearing**: Reload the VS Code window (`Cmd+Shift+P` > "Reload Window")
- **Configuration scope**: Check whether the server is registered for your workspace or user profile
- **Copilot required**: MCP support requires GitHub Copilot extension

## See Also

- [VS Code installation](/guide/installation/vscode)
- [Configuration reference](/guide/configuration)
- [Troubleshooting](/troubleshooting/clients)
