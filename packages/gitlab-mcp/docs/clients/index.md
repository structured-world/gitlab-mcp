---
title: Supported MCP Clients Overview
description: "Complete guide to all supported MCP clients for GitLab MCP Server. Setup instructions for Claude Desktop, Claude Code, VS Code, Cursor, Windsurf, Cline, Roo Code and Codex with config file locations."
head:
  - - meta
    - name: keywords
      content: MCP clients, GitLab MCP setup, Claude Desktop, Claude Code, VS Code, Cursor, Windsurf, Cline, Roo Code
---

# Supported MCP Clients

GitLab MCP works with all major AI coding assistants that support the Model Context Protocol.

## Client Overview

| Client | Transport | Auto-Detect | Setup Guide |
|--------|-----------|-------------|-------------|
| [Claude Desktop](/clients/claude-desktop) | stdio | App bundle | JSON config |
| [Claude Code](/clients/claude-code) | stdio | CLI command | CLI or JSON |
| [Cursor](/clients/cursor) | stdio | Config dir | JSON config |
| [VS Code](/clients/vscode) | stdio | Config dir | JSON config |
| [Windsurf](/clients/windsurf) | stdio | Config dir | JSON config |
| [Cline](/clients/cline) | stdio | Extension dir | JSON config |
| [Roo Code](/clients/roo-code) | stdio | Config dir | JSON config |
| [Codex](/guide/installation/codex) | stdio or HTTP | CLI command | Plugin or `codex mcp` |
| [Antigravity CLI](/clients/antigravity) | stdio or HTTP | No | Workspace JSON |

Remote HTTP support and configuration syntax depend on the client. Follow its
specific guide when connecting to a [remote server deployment](/deployment/);
a stdio-only configuration may need a supported HTTP-to-stdio adapter.

## Codex and Claude paths

Codex and Claude Code can use the same GitLab account side by side; installing one
never changes the other's configuration.

| Path | Install | Sign-in | Settings | Needs |
| --- | --- | --- | --- | --- |
| [Codex desktop plugin, local mode](/guide/installation/codex#plugin) | Plugins Directory, from a marketplace | Personal access token in the plugin panel | Native settings page and connection panel | Node.js 24+, network access to GitLab |
| [Codex desktop plugin, existing server](/guide/installation/codex#configure-the-installed-plugin) | Same plugin | Browser sign-in, bearer token or none, as the operator configures | Same | Node.js 24+, an operator's HTTP MCP endpoint |
| [Codex CLI, standalone server](/guide/installation/codex#local-server) | `npx @structured-world/gitlab-mcp install --codex` | Token from the environment, or browser sign-in to an HTTP server | Settings tools | Codex CLI, Node.js 24+ |
| [Claude Code](/clients/claude-code) | `claude mcp add` | Token, or OAuth to an HTTP server | Settings tools | Claude Code, Node.js 24+ for stdio |
| [Claude Desktop](/clients/claude-desktop) | MCPB extension | Token in the extension settings | Settings tools | Claude Desktop |

Settings tools (`get_settings`, `update_settings`, `manage_context`) work in every
client; see [Settings](/configuration/settings). Claude Channels and the
[channel gateway](/advanced/channel-gateway) are specific to Claude Code. The
[release qualification guide](/guides/codex-qualification#surface-and-runtime-boundaries)
records what each surface is verified for; a surface not listed there is not claimed.
Codex cloud tasks and classic ChatGPT chats cannot start the local plugin.

## Automatic Setup

The [setup wizard](/guide/installation/wizard) automatically detects installed clients and configures them:

```bash
npx @structured-world/gitlab-mcp setup
```

Or install to specific clients directly:

```bash
# Install to all detected clients
npx @structured-world/gitlab-mcp install --all

# Install to specific clients
npx @structured-world/gitlab-mcp install --claude-desktop --cursor
```

## Config File Locations

### macOS

| Client | Path |
|--------|------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | `~/.claude.json` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` (per-project) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Roo Code | `~/.roo/mcp.json` |
| Codex | `~/.codex/config.toml` |

### Windows

| Client | Path |
|--------|------|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `%USERPROFILE%\.claude.json` |
| Cursor | `%USERPROFILE%\.cursor\mcp.json` |
| VS Code | `.vscode\mcp.json` (per-project) |
| Windsurf | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` |
| Cline | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| Roo Code | `%USERPROFILE%\.roo\mcp.json` |
| Codex | `%USERPROFILE%\.codex\config.toml` |

### Linux

| Client | Path |
|--------|------|
| Claude Desktop | `~/.config/claude/claude_desktop_config.json` |
| Claude Code | `~/.claude.json` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` (per-project) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Roo Code | `~/.roo/mcp.json` |
| Codex | `~/.codex/config.toml` |

`CODEX_HOME` moves the Codex file on every platform.

## Next Steps

- [Setup Wizard](/guide/installation/wizard) — automatic configuration
- [Manual Configuration](/guide/installation/manual) — edit config files directly
- [Deployment Options](/deployment/) — local vs remote server
