# Claude Desktop (MCPB)

Install GitLab MCP as a Claude Desktop Extension with one click.

## One-Click Install

Download the latest bundle and open it:

<a href="/downloads/gitlab-mcp-latest.mcpb" class="vp-button brand">
  Download gitlab-mcp.mcpb
</a>

Or drag-and-drop the `.mcpb` file into your Claude Desktop window.

## What Happens

1. Claude Desktop shows the extension details
2. You enter your GitLab token and instance URL
3. The extension installs locally — no external services needed
4. All 44 tools become available in your Claude conversations

## Configuration

During installation, you'll be prompted for:

| Setting | Required | Description |
|---------|----------|-------------|
| GitLab Token | Yes | Personal Access Token with `api` + `read_user` scopes |
| GitLab URL | No | Instance URL (default: `https://gitlab.com`) |
| Read-Only Mode | No | Disable all write operations |

## Manual Installation

If you prefer manual setup, use the [npm method](/guide/installation/npm) or [JSON configuration](/clients/claude-desktop) instead.

## Updating

When a new version is released, download the latest `.mcpb` from the
[documentation site](/downloads/gitlab-mcp-latest.mcpb) or the
[GitHub releases page](https://github.com/structured-world/gitlab-mcp/releases).

## Advanced Configuration

The MCPB bundle exposes three core settings via `user_config`. For advanced environment variables (`GITLAB_DENIED_ACTIONS`, `GITLAB_TOOL_*`, `USE_*` flags), use [manual JSON configuration](/clients/claude-desktop) or see the [Customization guide](/advanced/customization).

## Troubleshooting

- **"Node.js version too old"** — Ensure Claude Desktop is updated to the latest version
- **Extension doesn't appear** — Restart Claude Desktop after installation
- **Token errors** — Verify your token has `api` and `read_user` scopes
