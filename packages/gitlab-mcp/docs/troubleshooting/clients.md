---
title: Client Issues
description: "Troubleshoot MCP client integration with GitLab MCP Server. Fix issues with Claude Desktop, VS Code, Cursor, Windsurf, Cline and the Codex plugin including config loading, detection, sign-in and permissions."
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
| Codex | `codex` in PATH | Codex CLI installed |

The ChatGPT desktop app does not put its bundled Codex CLI on `PATH`, so the
wizard does not detect it. The desktop plugin needs neither the wizard nor the CLI;
see [Codex plugin](#codex-plugin).

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

### Codex plugin {#codex-plugin}

The configurable plugin keeps its connection in a private panel. Open the plugin's
settings and choose **Set up, change or reconnect GitLab**, or ask Codex to open the
GitLab connection panel. Enter tokens only in the panel's password field, never in
the chat. A failed change keeps the previously saved connection. The panel reports
the failure and the stage it happened in.

| Symptom | Cause | Fix and how to verify |
| --- | --- | --- |
| The plugin is installed but its tools or panel never appear | Node.js 24 or later is missing: the plugin runs on the Node.js of this computer, which is not bundled | Install Node.js 24+, restart the app, open a new chat with the plugin enabled |
| GitLab tools are listed twice, or the plugin's settings never take effect | A standalone entry also registers GitLab MCP. An entry named `gitlab-sw` in `config.toml` hides the plugin's server; one under another name runs beside it | `codex mcp list`, then `codex mcp remove <name>`. Start a new chat and check that each GitLab tool appears once |
| "Authentication was rejected" | The token is wrong, revoked or expired, or browser sign-in expired | Create a new token, enter it in the panel and connect. For browser sign-in choose **Reconnect saved connection** or **Continue browser sign-in** |
| "The account lacks permission" | The token lacks the `api` or `read_user` scope, or the account cannot reach the project | Replace the token with one that has both scopes. Ask Codex to check the GitLab connection: `check_connection` reports the account, restrictions and recommendations |
| Browser sign-in was denied or abandoned | Consent was not given at GitLab | The saved connection is unchanged. **Cancel setup** ends the attempt; **Continue browser sign-in** starts again |
| "The TLS certificate could not be verified" | The GitLab or MCP server certificate is issued by a CA your computer does not trust | Node.js does not read the system trust store by default. Provide the CA chain as a PEM file through `NODE_EXTRA_CA_CERTS` (or `GITLAB_CA_CERT_PATH` for GitLab) in the environment Codex starts the plugin with; local mode passes both to its runtime. Do not disable certificate verification |
| "The address could not be resolved" or "The server is unreachable" | Hostname, VPN or proxy problem | Check the address in a browser on the same computer. Local mode passes `HTTPS_PROXY` and `NO_PROXY` from Codex's environment to its runtime |
| A feature is missing or refused | The GitLab version or tier does not offer it, or settings turn it off | Ask Codex to check the GitLab connection; it reports the version, tier and active restrictions. See [Settings](/configuration/settings) |

**Disconnect** deletes the saved credentials on this computer but does not revoke
the token or OAuth grant at GitLab; revoke it in GitLab when it is no longer needed.
See the [Codex installation guide](/guide/installation/codex) for upgrade and removal.

## Startup Log Spam {#jsonrpc-parse-errors}

### "Failed to parse JSONRPC message from server"

**Symptom**: On startup the MCP client prints a burst of parse errors such as:

```
Failed to parse JSONRPC message from server
pydantic_core._pydantic_core.ValidationError: 1 validation error for JSONRPCMessage
  Invalid JSON: expected value at line 1 column 5
```

**Cause**: The server version being launched writes log lines to stdout, which the
MCP stdio protocol reserves for JSON-RPC frames. Current releases always log to
stderr in stdio mode; this symptom means an outdated package build is running,
usually from a stale `npx` cache (`npx -y` reuses a previously downloaded version).

**Fix**:
```bash
# Clear the npx cache so the latest release is fetched
# (cache lives in ~/.npm/_npx)
npm cache clean --force

# Or pin the latest release explicitly in your client config
npx -y @structured-world/gitlab-mcp@latest
```

See [Log Destinations](/guide/configuration#log-destinations-stdout-vs-stderr) for
how log output is routed per transport mode.

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
