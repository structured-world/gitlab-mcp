---
title: Codex Installation Guide
description: 'Install the local GitLab MCP plugin in Codex desktop, then configure a GitLab instance or an existing HTTP MCP server. Standalone registration is also supported.'
head:
  - - meta
    - name: keywords
      content: gitlab mcp codex, codex plugin, chatgpt desktop plugin, codex cli, config.toml, codex mcp add
---

# Codex Installation Guide

GitLab MCP reaches Codex and the ChatGPT desktop app in two ways:

| Path                          | Runs where                                | Sign-in                  | Use when                                 |
| ----------------------------- | ----------------------------------------- | ------------------------ | ---------------------------------------- |
| [Plugin](#plugin)             | Local core or an existing HTTP MCP server | Token or browser sign-in | Configure either mode after installation |
| [Local server](#local-server) | Your computer, started by Codex           | Personal access token    | You work alone or offline from a server  |

Both can be installed side by side with Claude Code; neither touches Claude configuration.

Plugin chats share the selected connection. Updating OAuth credentials keeps that
selection and existing transports; choosing another account or disconnecting
invalidates older callbacks. Refresh operations are coordinated across local
plugin processes so a rotating refresh token is used only once. Process termination
releases coordination automatically, without a stale lease.

## Plugin

The local plugin starts before a target is configured. It includes the core runtime,
production dependencies, GitLab skills and a private connection panel. Install
Node.js 24 or later. The Node executable itself is not bundled.

### Shared sw.foundation marketplace

The shared [sw.foundation catalog](https://repo.sw.foundation/plugins/) lists
verified released plugins. After the marketplace is published, add it once:

```bash
codex plugin marketplace add structured-world/repo --sparse .agents/plugins
```

[Open shared marketplace installation in Codex](codex://plugins/install/gitlab-mcp?marketplace=sw-foundation)

The GitLab entry appears after the configurable plugin's first successful release.
It references the exact verified source commit and published npm runtime. Install
Node.js 24+ and npm; the runtime downloads on first use. Refresh the catalog with
`codex plugin marketplace upgrade sw-foundation` and review plugin updates in Codex.
For a standalone download with its dependencies already included, use the ZIP below.

### Install from a release

Download the [Codex marketplace ZIP](https://github.com/structured-world/gitlab-mcp/releases/latest/download/gitlab-mcp-codex.zip)
and its [SHA-256 checksum](https://github.com/structured-world/gitlab-mcp/releases/latest/download/gitlab-mcp-codex.zip.sha256).
The release workflow builds these separately from the Claude Desktop MCPB bundles.
Older releases may not contain these assets; for unreleased changes, build from source.
Successful pull request checks also publish a `codex-plugin` Actions artifact
containing the validated ZIP and checksum for desktop qualification before release.

Verify the ZIP against the checksum from the same release (`shasum -a 256 -c
gitlab-mcp-codex.zip.sha256` on macOS, `sha256sum -c` on Linux, or compare
`Get-FileHash` on Windows). Extract the whole archive into `gitlab-mcp-codex`,
including its hidden `.agents` directory, then register that directory:

```bash
codex plugin marketplace add ./gitlab-mcp-codex
```

[Open installation in Codex](codex://plugins/install/gitlab-mcp?marketplace=gitlab-mcp)

The button requires the marketplace registration above. It opens Codex's install
flow, where you review and confirm installation. Alternatively, run
`codex plugin add gitlab-mcp@gitlab-mcp`. No GitLab address or credentials are
needed until you open the connection panel after installation.

### Install from the repository marketplace

Once the connector version has been published to npm, you can avoid downloading
and extracting a ZIP. Install Node.js 24+ and npm, then add the repository once:

```bash
codex plugin marketplace add structured-world/gitlab-mcp
```

[Open repository installation in Codex](codex://plugins/install/gitlab-mcp?marketplace=gitlab-mcp-dev)

This marketplace uses the exact npm version declared in its manifest and downloads
it on first use. A Git ref containing unpublished code does not make that npm
version available.

### Configure the installed plugin

You can also install from that marketplace in the Plugins Directory. Open the
plugin's settings and choose **Set up, change or reconnect GitLab**, or ask to open
the GitLab connection panel. Choose either:

- **GitLab instance, run MCP locally:** enter the GitLab address and a personal
  access token. The plugin starts and stops the core process itself. GitLab 16.0+
  is supported; no separately started HTTP server, PostgreSQL or Prisma is needed.
- **Existing GitLab MCP server:** enter its Streamable HTTP endpoint and choose
  browser sign-in, a bearer token, or no authentication as configured by its operator.
  For OAuth, select **Continue browser sign-in**, authorize, then **Refresh status**.
  The server must support OAuth discovery and registration for browser sign-in.

Enter secrets only in the password field, never in the conversation. An unsuccessful
change leaves the saved connection intact. **Cancel setup** ends pending sign-in;
**Reconnect saved connection** retries it; **Disconnect** deletes saved credentials
and stops the local child or closes the remote transport. This does not revoke a
GitLab PAT or remote grant at its issuer.

For slow local instances, **Local connection options** exposes the core initialization
budget (`GITLAB_INIT_TIMEOUT_MS`). Leaving it empty keeps the core default of 5000 ms.
The panel accepts 1000 to 45000 ms, reserving time for the host's request deadline.
The plugin does not increase it automatically after a failed connection.

The verified identity appears after connecting. Account presets, scope, read-only
mode and tool groups remain at the selected backend; see [Account settings](/configuration/settings).
Changing a connection applies to this user's other plugin processes as well.

Codex [install links](https://learn.chatgpt.com/docs/app/commands#plugin-install)
work only with known marketplaces. They do not register a repository or import a
ZIP URL. Public local-MCP directory listings separately require OpenAI approval.

To update, download and extract the new release archive into the same directory and
install again. Codex replaces the cached copy. Connection configuration lives in the
host-provided `PLUGIN_DATA` directory, independently of the cached version.
Disable or remove the plugin through Codex to stop its transport and local child.
Disconnect first if you also want to erase saved credentials. Claude configuration,
standalone registrations and account settings on a remote server remain unchanged.
No separate MCP entry is created by the configurable plugin.

### Moving from a local server to the plugin

The plugin's server is named `gitlab-sw`, like the entry `gitlab-mcp install --codex` writes. While both exist, Codex runs the `gitlab-sw` entry from `config.toml` and the plugin's server stays unused, so remove the entry after installing the plugin:

```bash
codex mcp remove gitlab-sw
```

An entry you added by hand under another name, such as `gitlab`, runs next to the plugin and Codex lists the tools twice; remove it the same way, by its name.

## Local server

`gitlab-mcp install` registers a local server through the Codex CLI, which keeps the rest of `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) as it is:

```bash
GITLAB_API_URL=https://gitlab.example.com GITLAB_TOKEN=glpat-... \
  npx @structured-world/gitlab-mcp install --codex
```

To register a GitLab MCP server you already reach over HTTP instead, pass its endpoint; Codex then starts the GitLab sign-in in the browser:

```bash
npx @structured-world/gitlab-mcp install --codex --url https://mcp.example.com/mcp
```

The installer:

- writes the `gitlab-sw` entry and refuses to replace an existing one without `--force`; the name is distinct from the generic `gitlab` other GitLab servers use, because Codex runs only one server of a name;
- with `--force`, backs up `config.toml`, replaces only the `gitlab-sw` entry and restores the backup if Codex fails to save the new one or keeps it disabled; a new entry Codex saved wrongly is removed;
- stops when a plugin or project configuration already provides a server named `gitlab-sw`, which only that plugin or project can change;
- reports GitLab MCP registered under other names, including by an installed plugin, because Codex would list its tools twice; it leaves them in place, remove the one you do not use with `codex mcp remove <name>` or by disabling the plugin;
- reports an installed GitLab MCP plugin, enabled or disabled, whose server the `gitlab-sw` entry hides;
- reads back what Codex saved, reports a new entry another configuration keeps disabled and leaves it in place, and reports a sign-in that did not finish (`codex mcp login gitlab-sw`).

Preview the entry without writing it:

```bash
npx @structured-world/gitlab-mcp install --codex --show
```

```toml
[mcp_servers.gitlab-sw]
command = "npx"
args = ["-y", "@structured-world/gitlab-mcp"]

[mcp_servers.gitlab-sw.env]
GITLAB_API_URL = "https://gitlab.example.com"
GITLAB_TOKEN = "glpat-..."
```

## See Also

- [`gitlab-mcp install`](/cli/install)
- [Codex workflows](/guides/codex-workflows)
