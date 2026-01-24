---
title: Installation Overview
description: "Choose your preferred installation method — npm, Docker, Claude Desktop, VS Code, or manual setup"
---

# Installation

Choose the installation method that best fits your workflow.

## Recommended: Setup Wizard

The fastest way to get started. The interactive wizard auto-detects your environment and configures everything:

```bash
npx @structured-world/gitlab-mcp setup
```

See [Setup Wizard](/guide/installation/wizard) for a detailed walkthrough.

## Installation Methods

| Method | Best For | Guide |
|--------|----------|-------|
| [Setup Wizard](/guide/installation/wizard) | First-time setup, auto-configuration | Interactive, detects clients |
| [npm / npx](/guide/installation/npm) | Quick start, CI/CD | Minimal config, no install |
| [Docker](/guide/installation/docker) | Teams, server deployments | Isolated, scalable |
| [Claude Desktop](/guide/installation/claude-desktop) | Claude Desktop users | One-click .mcpb extension |
| [VS Code](/guide/installation/vscode) | VS Code + GitHub Copilot users | One-click install |
| [Codex](/guide/installation/codex) | OpenAI Codex CLI users | Direct integration |
| [Manual](/guide/installation/manual) | Custom setups, advanced users | Full control |

## Prerequisites

- **Node.js >= 24.0.0** (for npm/npx methods)
- **GitLab Personal Access Token** with `api` and `read_user` scopes
- One or more [supported MCP clients](/clients/)

## Next Steps

- [Client-specific setup guides](/clients/)
- [Deployment options](/deployment/)
- [Configuration reference](/guide/configuration)
