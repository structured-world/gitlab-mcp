---
title: VS Code Setup
description: "Add GitLab MCP Server to VS Code or VS Code Insiders with one-click install or settings.json config"
head:
  - - meta
    - name: keywords
      content: gitlab mcp vs code, vscode mcp server, github copilot, one-click install, mcp.json, vs code insiders
---

# VS Code Installation

Configure GitLab MCP Server in Visual Studio Code.

## One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22gitlab-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)

## Manual Configuration

Create or edit `.vscode/mcp.json` in your workspace:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "gitlab-token",
      "description": "GitLab Token",
      "password": true
    }
  ],
  "servers": {
    "GitLab-MCP": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "${input:gitlab-token}",
        "GITLAB_API_URL": "https://gitlab.com",
        "GITLAB_READ_ONLY_MODE": "true"
      }
    }
  }
}
```

::: tip
Using `${input:gitlab-token}` prompts for the token securely each session, avoiding hardcoded secrets.
:::

## VS Code Insiders

[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP_Server-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?%7B%22name%22%3A%22gitlab-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)

The same configuration works for VS Code Insiders.
