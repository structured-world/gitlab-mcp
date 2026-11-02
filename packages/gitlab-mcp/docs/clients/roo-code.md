---
title: Roo Code Integration Guide
description: "Step-by-step guide to configure GitLab MCP Server with Roo Code. Connect your GitLab projects for AI-assisted development workflows including merge requests and issue management."
head:
  - - meta
    - name: keywords
      content: Roo Code, GitLab MCP, AI assistant, MCP configuration, MCP tools, GitLab integration
---

# Roo Code Integration Guide

Configure GitLab MCP for the Roo Code extension. Its
[MCP configuration reference](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/)
describes the project and global configuration formats.

## Open the active configuration

In Roo Code's MCP settings, choose **Edit Project MCP** for the workspace or
**Edit Global MCP** for all workspaces. Project configuration overrides global
configuration for the same server name.

For the standard VS Code profile, automatic setup writes the extension's global
`settings/mcp_settings.json`:

```bash
npx @structured-world/gitlab-mcp install --roo-code
```

With a custom VS Code profile, another editor or Roo's custom storage path, open
**Edit Global MCP** to find and edit the active configuration. The installer does
not migrate the unused home-level `~/.roo/mcp.json` file.

## Detection

| Method | Details |
|--------|---------|
| Type | Config directory |
| Project path | `.roo/` in the workspace |
| Global configuration | Open with **Edit Global MCP** |

## Config File Location

| OS | Path |
|----|------|
| All platforms, project | `.roo/mcp.json` in the workspace root |
| All platforms, global | `mcp_settings.json` opened by Roo Code |

## Configuration

Add to the configuration file opened by Roo Code:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "glpat-xxxxxxxxxxxxxxxxxxxx",
        "GITLAB_API_URL": "https://gitlab.com"
      }
    }
  }
}
```

## Remote Server

Connect to a running GitLab MCP HTTP server:

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "streamable-http",
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

## Verification

1. Open Roo Code
2. Check the MCP servers panel
3. Verify "gitlab" is connected
4. GitLab tools should be available in chat

## Troubleshooting

- **Config directory missing**: Use **Edit Project MCP** to create the workspace configuration
- **Server not appearing**: Restart Roo Code after editing `mcp.json`
- **JSON syntax errors**: Validate the file with a JSON linter

## See Also

- [Quick Start](/guide/quick-start)
- [Configuration reference](/guide/configuration)
- [Troubleshooting](/troubleshooting/clients)
