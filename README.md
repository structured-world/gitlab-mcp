# GitLab MCP Server

**Maintained by:** [Dmitry Prudnikov](https://github.com/polaz) | **Original Author:** [zereight](https://github.com/zereight)

## @structured-world/gitlab-mcp

A Model Context Protocol server providing AI agents with access to the GitLab API. Fork of [zereight/gitlab-mcp](https://github.com/zereight/gitlab-mcp) with bug fixes, strict TypeScript, and expanded features.

![npm version](https://img.shields.io/npm/v/@structured-world/gitlab-mcp) ![npm downloads](https://img.shields.io/npm/dm/@structured-world/gitlab-mcp) ![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg) ![Release](https://github.com/structured-world/gitlab-mcp/workflows/Release/badge.svg) ![Codecov](https://codecov.io/gh/structured-world/gitlab-mcp/branch/main/graph/badge.svg) [![Coverage Report](https://img.shields.io/badge/Coverage-Live%20Report-brightgreen?logo=github)](https://structured-world.github.io/gitlab-mcp/coverage/)

## One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?name=gitlab-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP_Server-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?name=gitlab-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40structured-world%2Fgitlab-mcp%22%5D%7D)

## Quick Start

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

**Requirements:** Node.js >= 24.0.0

## Features

- **47 tools** across 17 entity types — projects, merge requests, pipelines, work items, wiki, and more
- **CQRS architecture** — `browse_*` for queries, `manage_*` for commands
- **Multiple transports** — stdio, SSE, StreamableHTTP
- **OAuth 2.1** — Per-user authentication via Claude Custom Connector
- **Read-only mode** — Safe operation for production environments
- **Auto-discovery** — Detects GitLab config from git remotes
- **Fine-grained control** — Enable/disable tool groups, filter actions, customize descriptions
- **Docker support** — `ghcr.io/structured-world/gitlab-mcp:latest`

## Documentation

Full documentation is available at **[docs.gitlab-mcp.sw.foundation](https://docs.gitlab-mcp.sw.foundation)**

| Section | Description |
|---------|-------------|
| [Installation](https://structured-world.github.io/gitlab-mcp/guide/installation/npm) | npm, Docker, VS Code, Codex |
| [Configuration](https://structured-world.github.io/gitlab-mcp/guide/configuration) | Environment variables, feature flags |
| [Tool Reference](https://structured-world.github.io/gitlab-mcp/tools/) | All 47 tools with parameters |
| [OAuth Setup](https://structured-world.github.io/gitlab-mcp/security/oauth) | Team authentication with Claude |
| [TLS/HTTPS](https://structured-world.github.io/gitlab-mcp/advanced/tls) | Production deployment with SSL |
| [Customization](https://structured-world.github.io/gitlab-mcp/advanced/customization) | Tool descriptions, action filtering |
| [CLI Tools](https://structured-world.github.io/gitlab-mcp/cli/list-tools) | Browse and export tool documentation |

### Auto-generated Tool Reference

For the complete tool reference with parameters:

```bash
# View locally
yarn list-tools --detail

# Generate documentation
yarn list-tools --export --toc > docs/TOOLS.md
```

See [docs/TOOLS.md](docs/TOOLS.md) for the auto-generated reference.

## Docker

```bash
# HTTP mode
docker run -e PORT=3002 -e GITLAB_TOKEN=your_token -p 3333:3002 \
  ghcr.io/structured-world/gitlab-mcp:latest

# stdio mode
docker run -i --rm -e GITLAB_TOKEN=your_token \
  ghcr.io/structured-world/gitlab-mcp:latest
```

## Feature Flags

| Flag | Default | Tools Enabled |
|------|---------|---------------|
| `USE_LABELS` | `true` | Label management |
| `USE_MRS` | `true` | Merge requests |
| `USE_FILES` | `true` | File operations |
| `USE_VARIABLES` | `true` | CI/CD variables |
| `USE_WORKITEMS` | `true` | Issues, epics, tasks |
| `USE_WEBHOOKS` | `true` | Webhook management |
| `USE_SNIPPETS` | `true` | Code snippets |
| `USE_INTEGRATIONS` | `true` | 50+ integrations |
| `USE_GITLAB_WIKI` | `false` | Wiki pages |
| `USE_MILESTONE` | `false` | Milestones |
| `USE_PIPELINE` | `false` | Pipelines & CI/CD |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and PR guidelines.

## Support the Project

<div align="center">

![USDT TRC-20 Donation QR Code](assets/usdt-qr.svg)

USDT (TRC-20): `TFDsezHa1cBkoeZT5q2T49Wp66K8t2DmdA`

</div>

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

### Attribution

This software includes code originally developed under the MIT License:
- Original project: [zereight/gitlab-mcp](https://github.com/zereight/gitlab-mcp)
- See [LICENSE.MIT](LICENSE.MIT) for the original MIT license

---

**Maintained by [Dmitry Prudnikov](https://github.com/polaz)** | **Original work by [zereight](https://github.com/zereight)**
