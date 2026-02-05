---
title: GitLab MCP Setup Wizard
description: "Interactive setup wizard for GitLab MCP Server. Auto-detects MCP clients, guides through GitLab authentication, and generates configuration for local or Docker deployments."
head:
  - - meta
    - name: keywords
      content: gitlab mcp setup, mcp setup wizard, gitlab token configuration, mcp client detection, claude desktop setup, cursor mcp setup, gitlab mcp server mode
---

# GitLab MCP Setup Wizard

Interactive setup wizard that guides you through configuring GitLab MCP. Detects your environment, walks through GitLab authentication, and installs configuration to your MCP clients or Docker.

## Usage

```bash
gitlab-mcp setup [--mode=<mode>]
```

## Options

| Flag | Description | Values |
|------|-------------|--------|
| `--mode` | Skip mode selection | `local`, `server`, `configure-existing` |

## Modes

### Local (stdio)

Configures GitLab MCP for local AI IDE clients. The wizard:

1. Prompts for GitLab instance URL
2. Guides through token creation/entry
3. Tests the connection
4. Configures tool selection (preset/manual/advanced)
   - Advanced mode includes: feature flags, read-only mode, cross-reference hints (`GITLAB_CROSS_REFS`), scope restrictions, and log level
5. Detects and installs to selected MCP clients

```bash
gitlab-mcp setup --mode=local
# or use the alias:
gitlab-mcp init
```

### Server (HTTP/SSE)

Sets up GitLab MCP as a Docker-based HTTP server. The wizard:

1. Verifies Docker and Docker Compose
2. Selects deployment type (standalone, external-db, compose-bundle)
3. Configures port and optional OAuth
4. Generates docker-compose.yml and .env
5. Optionally starts the container

```bash
gitlab-mcp setup --mode=server
# or use the alias:
gitlab-mcp docker init
```

### Configure Existing

Modifies an existing GitLab MCP installation:

1. Detects configured clients and running containers
2. Lets you choose what to modify
3. Updates token, URL, tool groups, or preset

```bash
gitlab-mcp setup --mode=configure-existing
```

## Discovery Phase

Before mode selection, the wizard runs automatic discovery:

| Detection | Method |
|-----------|--------|
| Claude Desktop | macOS app bundle (`com.anthropic.claudefordesktop`) |
| Claude Code | CLI command (`claude`) |
| Cursor | Config directory (`~/.cursor/`) |
| VS Code | Config directory (`.vscode/`) |
| Windsurf | Config directory (`~/.codeium/windsurf/`) |
| Cline | VS Code extension storage |
| Roo Code | Config directory (`~/.roo/`) |
| Docker | `docker` and `docker compose` commands |

## Examples

```bash
# Full interactive wizard
npx @structured-world/gitlab-mcp setup

# Direct to local setup
npx @structured-world/gitlab-mcp setup --mode=local

# Direct to server setup
npx @structured-world/gitlab-mcp setup --mode=server

# Modify existing configuration
npx @structured-world/gitlab-mcp setup --mode=configure-existing
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Setup completed successfully |
| `1` | Setup failed or was cancelled |

## See Also

- [Setup Wizard walkthrough](/guide/installation/wizard)
- [`gitlab-mcp init`](/cli/init) — alias for local setup
- [`gitlab-mcp install`](/cli/install) — client installation only
- [`gitlab-mcp docker`](/cli/docker) — Docker management
