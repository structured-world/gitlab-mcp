# Roo Code

Configure GitLab MCP for [Roo Code](https://roocode.com).

## Auto-Setup

```bash
npx @structured-world/gitlab-mcp install --roo-code
```

## Detection

| Method | Details |
|--------|---------|
| Type | Config directory |
| Path | `~/.roo/` |
| Auto-detected | Yes (when config directory exists) |

## Config File Location

| OS | Path |
|----|------|
| macOS | `~/.roo/mcp.json` |
| Windows | `%USERPROFILE%\.roo\mcp.json` |
| Linux | `~/.roo/mcp.json` |

## Configuration

Add to your `~/.roo/mcp.json`:

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

- **Config directory missing**: Create `~/.roo/` manually if it doesn't exist
- **Server not appearing**: Restart Roo Code after editing `mcp.json`
- **JSON syntax errors**: Validate the file with a JSON linter

## See Also

- [Quick Start](/guide/quick-start)
- [Configuration reference](/guide/configuration)
- [Troubleshooting](/troubleshooting/clients)
