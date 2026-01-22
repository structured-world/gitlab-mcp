---
layout: home

hero:
  name: GitLab MCP
  text: Model Context Protocol Server
  tagline: Connect AI agents to GitLab with 47 tools across 17 entity types
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: Tool Reference
      link: /tools/
    - theme: alt
      text: View on GitHub
      link: https://github.com/structured-world/gitlab-mcp

features:
  - icon: "\U0001F527"
    title: 47 Tools, 17 Entities
    details: Complete GitLab API coverage — projects, merge requests, pipelines, work items, wikis, and more.
  - icon: "\U0001F512"
    title: OAuth 2.1 & Read-Only Mode
    details: Per-user authentication via Claude Custom Connector or static tokens with granular access control.
  - icon: "\U0001F680"
    title: CQRS Architecture
    details: Consolidated action-based tools — browse_* for queries, manage_* for commands. Optimized for AI context windows.
  - icon: "\U0001F310"
    title: Multiple Transports
    details: stdio, SSE, and StreamableHTTP. Docker, npx, or direct Node.js. Auto-discovery from git remotes.
---

## One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?name=gitlab-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP_Server-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?name=gitlab-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)

## Quick Start

```bash
npx @structured-world/gitlab-mcp
```

Set `GITLAB_TOKEN` and optionally `GITLAB_API_URL` for self-hosted instances.

See the [Installation Guide](/guide/installation/npm) for detailed setup instructions.
