---
title: Client Issues
description: "Troubleshoot MCP client integration with GitLab MCP Server. Fix issues with Claude Desktop, VS Code, Cursor, Windsurf, and Cline including config loading, detection, and permissions."
head:
  - - meta
    - name: keywords
      content: MCP client issues, Claude Desktop, VS Code, Cursor, Windsurf, client configuration, troubleshooting
faq:
  - question: "Why does GitLab MCP show 'No MCP clients detected on this system'?"
    answer: "The setup wizard couldn't find any supported MCP clients. Install a supported client (Claude Desktop, VS Code, Cursor, etc.), open it at least once to create config directories, then re-run 'npx @structured-world/gitlab-mcp setup'."
  - question: "Why doesn't GitLab MCP server appear in my MCP client?"
    answer: "Check that you're editing the correct config file path for your client and OS. Validate your JSON syntax using 'jq . config-file.json' or 'python3 -m json.tool < config-file.json'. Common issues include trailing commas and unquoted strings."
  - question: "How do I validate my MCP client configuration JSON?"
    answer: "Use 'jq . ~/.cursor/mcp.json' or 'python3 -m json.tool < ~/.cursor/mcp.json' to validate JSON syntax. The command will show parsing errors if the JSON is malformed."
---

# Troubleshooting MCP Client Issues

Problems with MCP client detection, configuration, and connectivity.

## No Clients Detected {#no-clients}

### "No MCP clients detected on this system"

**Cause**: The setup wizard couldn't find any supported MCP clients.

**Fix**:
1. Install a [supported MCP client](/clients/)
2. Ensure the client has been opened at least once (to create config directories)
3. Re-run the setup wizard:
   ```bash
   npx @structured-world/gitlab-mcp setup
   ```

### Detection Methods

| Client | How Detected | Requirement |
|--------|-------------|-------------|
| Claude Desktop | macOS app bundle | App installed |
| Claude Code | `claude` in PATH | CLI installed |
| Cursor | `~/.cursor/` exists | Opened once |
| VS Code | `.vscode/` exists | Project workspace |
| Windsurf | `~/.codeium/windsurf/` exists | Opened once |
| Cline | Extension storage exists | Extension installed |
| Roo Code | `~/.roo/` exists | Opened once |

## Config Not Loaded {#config-not-loaded}

### Server Not Appearing in Client

**Check 1**: Config file path

Ensure you're editing the correct file. See [Clients](/clients/) for paths per OS.

**Check 2**: JSON syntax

Validate your config file:

```bash
# macOS/Linux
python3 -m json.tool < ~/.cursor/mcp.json

# Or use jq
jq . ~/.cursor/mcp.json
```

Common JSON errors:
- Trailing comma after last item
- Missing quotes around keys
- Comments (JSON doesn't support comments)

**Check 3**: Restart required

Most clients require a full restart after config changes:
- **Claude Desktop**: Quit and reopen
- **Cursor**: Close all windows and reopen
- **VS Code**: "Reload Window" (`Cmd+Shift+P`)
- **Windsurf**: Restart application

**Check 4**: Config structure

Ensure the `mcpServers` key is at the root level:

```json
{
  "mcpServers": {
    "gitlab": { ... }
  }
}
```

Not nested inside another object.

## Already Configured

### "Client already has gitlab-mcp configured"

This means an existing `gitlab` entry was found in the config.

**Options**:
1. Use `--force` to overwrite:
   ```bash
   npx @structured-world/gitlab-mcp install --cursor --force
   ```
2. Manually edit the config file to update specific values
3. A backup is created automatically when overwriting

## Command Not Found

### "npx: command not found"

**Cause**: Node.js is not installed or not in PATH.

**Fix**:
1. Install Node.js >= 24:
   ```bash
   # macOS (Homebrew)
   brew install node

   # Or use nvm
   nvm install 24
   nvm use 24
   ```
2. Verify: `node --version` and `npx --version`

### Full Path Workaround

If `npx` isn't in the client's PATH, use the full path:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "/usr/local/bin/npx",
      "args": ["-y", "@structured-world/gitlab-mcp"]
    }
  }
}
```

Find your npx path: `which npx`

## Client-Specific Issues

### Claude Desktop

- **macOS only**: Claude Desktop MCP is currently macOS-only for auto-detection
- **Logs**: `~/Library/Logs/Claude/mcp*.log`
- **Config test**: Open Claude, check MCP indicator icon (bottom-left)

### Cursor

- **Global config**: Uses `~/.cursor/mcp.json` (not per-project)
- **MCP panel**: Settings > MCP shows connected servers
- **Restart**: Close ALL Cursor windows, then reopen

### VS Code

- **Per-project**: Uses `.vscode/mcp.json` in workspace root
- **Copilot required**: MCP support needs GitHub Copilot extension
- **Multi-root workspaces**: Each workspace root needs its own config

### Cline

- **Extension required**: Must have `saoudrizwan.claude-dev` extension installed
- **Settings location**: Inside VS Code extension storage
- **Update path**: If extension ID changes, config path changes too

## Permission Issues

### "EACCES: permission denied"

**Cause**: Cannot write to the config file.

**Fix**:
```bash
# Fix permissions (replace path with your config)
chmod 644 ~/.cursor/mcp.json

# Or fix directory permissions
chmod 755 ~/.cursor
```

### Config in Protected Directory

If the config is in a system-protected location, run the install with elevated permissions or edit manually with `sudo`.

## See Also

- [Client configuration guides](/clients/)
- [Manual Configuration](/guide/installation/manual)
- [Connection Issues](/troubleshooting/connection)
