---
title: VS Code
description: "Configure GitLab MCP Server with VS Code — MCP extension setup for GitHub Copilot integration"
---

# VS Code (GitHub Copilot)

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
VS Code uses per-project MCP configuration. Create the config in each project's `.vscode/` directory.
:::

## Configuration

Create or edit `.vscode/mcp.json` in your project root:

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

1. Open the project in VS Code
2. Open GitHub Copilot chat
3. Check available MCP tools via the tools picker
4. GitLab tools should be listed

## Troubleshooting

- **Tools not appearing**: Reload the VS Code window (`Cmd+Shift+P` > "Reload Window")
- **Per-project vs global**: VS Code MCP is per-project; ensure `.vscode/mcp.json` is in your workspace root
- **Copilot required**: MCP support requires GitHub Copilot extension

## See Also

- [VS Code installation](/guide/installation/vscode)
- [Configuration reference](/guide/configuration)
- [Troubleshooting](/troubleshooting/clients)
