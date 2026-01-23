# gitlab-mcp install

Detect and install GitLab MCP configuration to MCP clients. Can run interactively (wizard) or non-interactively with flags.

## Usage

```bash
gitlab-mcp install [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--claude-desktop` | Install to Claude Desktop |
| `--claude-code` | Install to Claude Code |
| `--cursor` | Install to Cursor |
| `--vscode` | Install to VS Code (GitHub Copilot) |
| `--cline` | Install to Cline |
| `--roo-code` | Install to Roo Code |
| `--windsurf` | Install to Windsurf |
| `--all` | Install to all detected clients |
| `--show` | Preview configuration without writing |
| `--force` | Overwrite existing configurations |

## Interactive Mode

Without any client flags, the command runs an interactive wizard:

1. Detects all installed MCP clients
2. Shows detection results (installed, configured, etc.)
3. Presents multi-select for target clients
4. Confirms overwrite if already configured
5. Installs and shows results

```bash
npx @structured-world/gitlab-mcp install
```

## Non-Interactive Mode

Specify clients directly with flags:

```bash
# Install to specific clients
npx @structured-world/gitlab-mcp install --claude-desktop --cursor

# Install to all detected clients
npx @structured-world/gitlab-mcp install --all

# Force overwrite existing config
npx @structured-world/gitlab-mcp install --claude-desktop --force
```

## Preview Configuration

View the generated configuration without writing any files:

```bash
# Preview Claude Desktop config
npx @structured-world/gitlab-mcp install --show --claude-desktop

# Preview Cursor config
npx @structured-world/gitlab-mcp install --show --cursor
```

## Environment Variables

The install command reads from the current environment to build the server configuration:

| Variable | Purpose | Default |
|----------|---------|---------|
| `GITLAB_TOKEN` | Token to embed in config | — |
| `GITLAB_URL` | GitLab instance URL | `https://gitlab.com` |
| `GITLAB_MCP_PRESET` | Preset to apply | — |

## Backup Behavior

When overwriting an existing configuration, the installer creates a backup:

```
~/.cursor/mcp.json → ~/.cursor/mcp.json.backup-2025-01-24T12-00-00
```

## Supported Clients

| Client | Detection | Config Location (macOS) |
|--------|-----------|------------------------|
| Claude Desktop | App bundle | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | CLI command | `~/.claude.json` |
| Cursor | Config dir | `~/.cursor/mcp.json` |
| VS Code | Config dir | `.vscode/mcp.json` |
| Windsurf | Config dir | `~/.codeium/windsurf/mcp_config.json` |
| Cline | Extension storage | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Roo Code | Config dir | `~/.roo/mcp.json` |

See [Clients](/clients/) for paths on all platforms.

## See Also

- [`gitlab-mcp setup`](/cli/setup) — full setup wizard (includes install)
- [Client configuration guides](/clients/)
