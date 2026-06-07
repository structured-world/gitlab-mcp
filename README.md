# GitLab MCP Server

[![npm version](https://img.shields.io/npm/v/@structured-world/gitlab-mcp)](https://www.npmjs.com/package/@structured-world/gitlab-mcp) [![npm downloads](https://img.shields.io/npm/dm/@structured-world/gitlab-mcp)](https://www.npmjs.com/package/@structured-world/gitlab-mcp) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE) [![Release](https://github.com/structured-world/gitlab-mcp/workflows/Release/badge.svg)](https://github.com/structured-world/gitlab-mcp/actions) [![Coverage](https://codecov.io/gh/structured-world/gitlab-mcp/graph/badge.svg)](https://codecov.io/gh/structured-world/gitlab-mcp) [![Docs](https://img.shields.io/badge/docs-gitlab--mcp.sw.foundation-brightgreen)](https://gitlab-mcp.sw.foundation)

Advanced GitLab MCP server — CQRS tools that expose GitLab's API to AI agents. The
tool catalog and parameters are filtered to each instance's GitLab version, tier, and
token scopes, so the agent sees only what the connected instance actually supports.

Full documentation: **[gitlab-mcp.sw.foundation](https://gitlab-mcp.sw.foundation)**

## Packages

This repository is an nx monorepo. The server ships as a lightweight core package
plus an optional database backend, so the default install stays Prisma-free.

| Package | npm | Description |
|---------|-----|-------------|
| **[`@structured-world/gitlab-mcp`](packages/gitlab-mcp)** | [![npm](https://img.shields.io/npm/v/@structured-world/gitlab-mcp)](https://www.npmjs.com/package/@structured-world/gitlab-mcp) | The MCP server. Memory and file OAuth-session storage, no database dependency. |
| **[`@structured-world/gitlab-mcp-db`](packages/gitlab-mcp-db)** | [![npm](https://img.shields.io/npm/v/@structured-world/gitlab-mcp-db)](https://www.npmjs.com/package/@structured-world/gitlab-mcp-db) | Optional PostgreSQL/Prisma OAuth-session backend, for multi-instance deployments. |

Most users only need the core package. Add `gitlab-mcp-db` when you run multiple
replicas behind a load balancer and want OAuth sessions persisted in PostgreSQL
(`OAUTH_STORAGE_TYPE=postgresql`).

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

**Requirements:** Node.js >= 24. See the [core package README](packages/gitlab-mcp) for
the full feature list, transports (stdio / SSE / StreamableHTTP), OAuth 2.1 setup, and
Docker usage, or the [documentation site](https://gitlab-mcp.sw.foundation) for guides.

## Highlights

- **CQRS architecture** — `browse_*` for read-only queries, `manage_*` for writes;
  sub-resources fold into actions instead of new tools.
- **Instance-aware catalog** — tools, actions, and parameters resolve against GitLab
  version, tier, token scopes, admin mode, feature flags, and profiles.
- **Connection resilience** — bounded startup, auto-reconnect with exponential
  backoff, and a disconnected mode when GitLab is unreachable.
- **Multi-instance support** — GitLab.com, self-managed, and self-hosted instances
  with per-instance OAuth and rate limiting.
- **Multiple transports** — stdio, SSE, StreamableHTTP.
- **OAuth 2.1** — per-user authentication via Claude Custom Connector.
- **Docker** — `ghcr.io/structured-world/gitlab-mcp:latest` (core) and
  `ghcr.io/structured-world/gitlab-mcp-db:latest` (with the database backend).

## Development

```bash
yarn install        # install workspace dependencies
yarn build          # build all packages (nx)
yarn test           # run all tests (nx)
yarn lint           # typecheck + lint
```

Per-package commands run from `packages/gitlab-mcp` or via `yarn workspace`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are tracked on GitHub.

## License

[Apache-2.0](LICENSE)
