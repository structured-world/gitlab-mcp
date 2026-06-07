---
title: Supported MCP Clients Overview
description: "Complete guide to all supported MCP clients for GitLab MCP Server. Setup instructions for Claude Desktop, Claude Code, VS Code, Cursor, Windsurf, Cline, and Roo Code with config file locations."
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

All clients can also connect via HTTP (StreamableHTTP or SSE) to a [remote server deployment](/deployment/).

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

## Next Steps

- [Setup Wizard](/guide/installation/wizard) — automatic configuration
- [Manual Configuration](/guide/installation/manual) — edit config files directly
- [Deployment Options](/deployment/) — local vs remote server
