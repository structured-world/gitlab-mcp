---
title: GitLab MCP Setup Wizard Guide
description: "Complete guide to the interactive setup wizard for GitLab MCP Server. Auto-detects MCP clients, guides through authentication, configures tool presets, and deploys to local or Docker environments."
head:
  - - meta
    - name: keywords
      content: gitlab mcp setup wizard, interactive setup, guided configuration, tool presets, docker init, mcp client setup
---

# GitLab MCP Setup Wizard Guide

The interactive setup wizard (`gitlab-mcp setup`) guides you through configuring GitLab MCP for your environment. It auto-detects installed clients, Docker availability, and existing configurations.

## Quick Start

```bash
npx @structured-world/gitlab-mcp setup
```

## How It Works

The wizard runs through four phases:

### Phase 1: Discovery

Automatically detects:
- Installed MCP clients (Claude Desktop, Cursor, VS Code, etc.)
- Existing gitlab-mcp configurations
- Docker/Podman availability
- Running gitlab-mcp containers

### Phase 2: Mode Selection

Based on discovery results, you choose a setup mode:

| Mode | Description | When to Use |
|------|-------------|-------------|
| Configure existing | Modify an existing setup | Already have gitlab-mcp configured |
| New local (stdio) | Install to AI IDE clients | Personal use with Claude, Cursor, etc. |
| New server (HTTP/SSE) | Docker-based deployment | Team access, shared instance |

### Phase 3: Flow Execution

#### Local Setup Flow

1. **GitLab instance** — Choose gitlab.com or enter self-hosted URL
2. **Authentication** — Enter or create a Personal Access Token
3. **Connection test** — Verify token and API connectivity
4. **Tool configuration** — Choose a preset or manually select tool groups
5. **Client selection** — Pick which MCP clients to configure
6. **Installation** — Write configuration to selected clients

#### Server Setup Flow

1. **Docker check** — Verify Docker and Compose are available
2. **Deployment type** — Standalone, external PostgreSQL, or Compose bundle
3. **Port configuration** — Choose the SSE/HTTP port
4. **OAuth setup** — Optional multi-user authentication
5. **Tool configuration** — Select enabled tool groups
6. **Docker config** — Generate docker-compose.yml and .env
7. **Start container** — Optionally launch the service immediately

#### Configure Existing Flow

1. **Detect current setup** — Find configured clients and containers
2. **Select target** — Choose what to modify
3. **Update configuration** — Change tokens, URLs, tool groups, or presets

### Phase 4: Summary

Displays what was configured and next steps.

## Command Aliases

| Command | Equivalent To |
|---------|---------------|
| `gitlab-mcp init` | `gitlab-mcp setup --mode=local` |
| `gitlab-mcp docker init` | `gitlab-mcp setup --mode=server` |

## Tool Configuration

During setup, you choose how to configure enabled tools:

### Preset Mode

Select from predefined role-based presets:

| Preset | Description |
|--------|-------------|
| `developer` | Standard development tools (default) |
| `senior-dev` | Extended tools for senior engineers |
| `full-access` | All available tools |
| `devops` | CI/CD, pipelines, deployments |
| `code-reviewer` | Merge requests, code review tools |
| `readonly` | Read-only browsing tools only |

### Manual Mode

Toggle individual tool categories:

| Category | Tools |
|----------|-------|
| Labels | Label management |
| Merge Requests | MR operations |
| Files | File browsing and management |
| Variables | CI/CD variables |
| Work Items | Issues, epics, tasks |
| Webhooks | Webhook management |
| Snippets | Code snippets |
| Integrations | 50+ project integrations |
| Wiki | Wiki pages |
| Milestones | Milestone tracking |
| Pipelines | Pipeline and CI/CD jobs |
| Releases | Release management |
| Refs | Branch and tag management |
| Members | Team member management |
| Search | Cross-project search |

### Advanced Mode

Directly set environment variables for fine-grained control over timeouts, retries, denied tools regex, and more.

## Examples

```bash
# Full interactive wizard
npx @structured-world/gitlab-mcp setup

# Skip to local setup (stdio for IDE clients)
npx @structured-world/gitlab-mcp init

# Skip to server setup (Docker/HTTP)
npx @structured-world/gitlab-mcp docker init
```

## Next Steps

- [CLI Reference: setup](/cli/setup)
- [Client configuration guides](/clients/)
- [Deployment options](/deployment/)
