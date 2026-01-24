---
layout: home
description: "MCP server connecting AI agents to GitLab API with 44 tools across 18 entity types"

hero:
  name: GitLab MCP
  text: Model Context Protocol Server
  tagline: Connect AI agents to GitLab with 44 tools across 18 entity types
  image:
    src: /logo-hero.png
    alt: GitLab MCP Logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: Prompt Library
      link: /prompts/
    - theme: alt
      text: Tool Reference
      link: /tools/

features:
  - icon: "\U0001F527"
    title: 44 Tools, 18 Entities
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

<a href="/downloads/gitlab-mcp-latest.mcpb"><img src="https://img.shields.io/badge/Claude_Desktop-Install_Extension-F97316?style=for-the-badge&logoColor=white" alt="Install in Claude Desktop"></a>
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22gitlab-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP_Server-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?%7B%22name%22%3A%22gitlab-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)

::: warning After one-click install
You must configure `GITLAB_TOKEN` in your MCP client settings before the server can connect. See the [Installation Guide](/guide/installation/npm) for token setup.
:::

## Quick Start

::: tip Prerequisites
Create a [GitLab Personal Access Token](https://docs.gitlab.com/user/profile/personal_access_tokens/) with `api,read_user` scopes (or `read_api,read_user` for read-only mode) and export it:
```bash
export GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"
```
:::

```bash
npx @structured-world/gitlab-mcp
```

For self-hosted GitLab, also set `GITLAB_API_URL`:
```bash
export GITLAB_API_URL="https://your-gitlab.example.com"
```

See the [Installation Guide](/guide/installation/npm) for detailed setup instructions.
