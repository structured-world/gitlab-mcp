---
title: Codex Installation Guide
description: 'Install GitLab MCP in Codex and the ChatGPT desktop app as a plugin connected to a GitLab MCP server, or register a local server with gitlab-mcp install.'
head:
  - - meta
    - name: keywords
      content: gitlab mcp codex, codex plugin, chatgpt desktop plugin, codex cli, config.toml, codex mcp add
---

# Codex Installation Guide

GitLab MCP reaches Codex and the ChatGPT desktop app in two ways:

| Path                          | Runs where                       | Sign-in                     | Use when                                |
| ----------------------------- | -------------------------------- | --------------------------- | --------------------------------------- |
| [Plugin](#plugin)             | A GitLab MCP server in HTTP mode | GitLab OAuth in the browser | A team or company runs a shared server  |
| [Local server](#local-server) | Your computer, started by Codex  | Personal access token       | You work alone or offline from a server |

Both can be installed side by side with Claude Code; neither touches Claude configuration.

## Plugin

The plugin bundles the connection to a GitLab MCP server, the GitLab skills and the onboarding guide. It needs a server running in [HTTP mode](/guide/transport) with [OAuth](/security/oauth); whoever operates it builds the plugin for its address with [`gitlab-mcp plugin build`](/cli/plugin):

```bash
npx @structured-world/gitlab-mcp plugin build --endpoint https://mcp.example.com/mcp
codex plugin marketplace add ./gitlab-mcp-plugin
```

In Codex or the ChatGPT desktop app, open the Plugins Directory, choose the **GitLab by Structured World** marketplace and install the plugin. Codex opens GitLab in the browser to sign in. Then open the plugin's settings to choose a preset, read-only mode and the projects a chat may use; see [Account settings](/configuration/settings).

To update, rebuild into the same directory with the new package version and install the plugin again, from the Plugins Directory or with `codex plugin add gitlab-mcp@gitlab-mcp`; Codex replaces the cached copy. Disabling the plugin stops its server and keeps it installed. Removing it (`codex plugin remove gitlab-mcp@gitlab-mcp`) deletes the cached copy and leaves the rest of `config.toml`, Claude configuration and your account settings on the server as they are; the settings apply again when you reinstall.

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

- [`gitlab-mcp plugin`](/cli/plugin)
- [`gitlab-mcp install`](/cli/install)
- [Codex workflows](/guides/codex-workflows)
