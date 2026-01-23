# Claude Code

Configure GitLab MCP for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (CLI).

## Auto-Setup

```bash
npx @structured-world/gitlab-mcp install --claude-code
```

## Detection

| Method | Details |
|--------|---------|
| Type | CLI command |
| Command | `claude` |
| Auto-detected | Yes (when `claude` is in PATH) |

## Config File Location

| OS | Path |
|----|------|
| macOS | `~/.claude.json` |
| Windows | `%USERPROFILE%\.claude.json` |
| Linux | `~/.claude.json` |

## Configuration

Add to your `~/.claude.json`:

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

## CLI Installation

Claude Code also supports adding MCP servers via CLI:

```bash
claude mcp add gitlab -- npx -y @structured-world/gitlab-mcp
```

Set environment variables separately in your shell profile or `.env` file.

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

```bash
# Start Claude Code and check available tools
claude

# Within Claude Code, ask:
# "List available GitLab tools"
```

## Troubleshooting

- **Server not loading**: Restart Claude Code session after config changes
- **"Command not found"**: Ensure `npx` is available (Node.js >= 24)
- **Permission issues**: Check file permissions on `~/.claude.json`

## See Also

- [Quick Start](/guide/quick-start)
- [Configuration reference](/guide/configuration)
- [Troubleshooting](/troubleshooting/clients)
