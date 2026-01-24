---
title: CLI Reference
description: "Command-line interface for GitLab MCP Server — setup, init, install, docker, and list-tools commands"
---

# CLI Reference

GitLab MCP provides several CLI commands for setup, installation, and management.

## Commands

| Command | Description | Guide |
|---------|-------------|-------|
| [`gitlab-mcp setup`](/cli/setup) | Interactive setup wizard | Full environment detection and configuration |
| [`gitlab-mcp init`](/cli/init) | Quick local setup | Alias for `setup --mode=local` |
| [`gitlab-mcp install`](/cli/install) | Install to MCP clients | Detect and configure AI coding assistants |
| [`gitlab-mcp docker`](/cli/docker) | Docker management | Container lifecycle and instance management |
| [`gitlab-mcp list-tools`](/cli/list-tools) | Tool documentation | Browse and export available tools |

## Usage

All commands can be run via `npx`:

```bash
npx @structured-world/gitlab-mcp <command> [options]
```

Or if installed globally:

```bash
gitlab-mcp <command> [options]
```

## Server Mode

Without any command argument, `gitlab-mcp` starts the MCP server:

```bash
# stdio mode (default)
npx @structured-world/gitlab-mcp

# Force stdio mode
npx @structured-world/gitlab-mcp stdio

# HTTP mode (when PORT is set)
PORT=3333 npx @structured-world/gitlab-mcp
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--show-project-config` | Display project configuration and exit |
| `--auto` | Auto-discover profile from git remote |
| `--profile <name>` | Select a specific authentication profile |

## Next Steps

- [Setup Wizard guide](/guide/installation/wizard)
- [Configuration reference](/guide/configuration)
- [Deployment options](/deployment/)
