# Cursor

Configure GitLab MCP for [Cursor](https://cursor.sh).

## Auto-Setup

```bash
npx @structured-world/gitlab-mcp install --cursor
```

## Detection

| Method | Details |
|--------|---------|
| Type | Config directory |
| Path | `~/.cursor/` |
| Auto-detected | Yes (when config directory exists) |

## Config File Location

| OS | Path |
|----|------|
| macOS | `~/.cursor/mcp.json` |
| Windows | `%USERPROFILE%\.cursor\mcp.json` |
| Linux | `~/.cursor/mcp.json` |

## Configuration

Add to your `~/.cursor/mcp.json`:

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

1. Open Cursor
2. Go to **Settings > MCP**
3. Verify "gitlab" appears in the server list
4. Check that tools are available in the AI chat

## Troubleshooting

- **Server not appearing**: Restart Cursor after editing `mcp.json`
- **Config not recognized**: Ensure the file is valid JSON (no trailing commas)
- **"npx not found"**: Set the full path to npx in the `command` field

## See Also

- [Quick Start](/guide/quick-start)
- [Configuration reference](/guide/configuration)
- [Troubleshooting](/troubleshooting/clients)
