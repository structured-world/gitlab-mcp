---
title: Build the Codex Plugin Package
description: 'Use gitlab-mcp plugin build to package GitLab MCP as a Codex and ChatGPT plugin for an MCP endpoint you operate, as a local marketplace and a ZIP for directory submission.'
head:
  - - meta
    - name: keywords
      content: gitlab mcp codex plugin, codex plugin marketplace, chatgpt plugin, agent plugins, plugin zip, plugins directory
---

# Build the Codex Plugin Package

`gitlab-mcp plugin build` packages GitLab MCP as a plugin for Codex and the ChatGPT desktop app. The package connects to an MCP endpoint you operate: a [GitLab MCP server in HTTP mode](/guide/transport) with [OAuth](/security/oauth) enabled. Users sign in with their GitLab account in the browser when they install it; the package holds no credentials.

## Usage

```bash
npx @structured-world/gitlab-mcp plugin build --endpoint <url> [options]
```

## Options

| Flag                  | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `--endpoint <url>`    | MCP endpoint, for example `https://mcp.example.com/mcp`. Required   |
| `--out <dir>`         | Output directory. Default: `./gitlab-mcp-plugin`                    |
| `--public`            | Apply the Plugins Directory submission rules                        |
| `--privacy-url <url>` | Privacy policy of the endpoint operator. Required with `--public`   |
| `--terms-url <url>`   | Terms of service of the endpoint operator. Required with `--public` |

The endpoint must use HTTPS. Plain HTTP is accepted only on loopback (`localhost`, `127.0.0.1`, `::1`), for a server on the same machine. With `--public` the host must also be publicly reachable: not a private, reserved or special-purpose address, and not a special-use domain such as `.test`, `.invalid`, `.local` or `.internal`.

## Output

```
gitlab-mcp-plugin/
├── .agents/plugins/marketplace.json   # local marketplace listing the plugin
├── plugins/gitlab-mcp/                # the plugin: plugin.json, mcp.json, skills/, assets/
└── gitlab-mcp-<version>.zip           # the same plugin as one archive
```

The version is the version of the installed package. A rebuild replaces only `plugins/gitlab-mcp/` and produces a byte-identical ZIP; the command prints its SHA-256. When `--out` already holds a marketplace, the GitLab entry is added to or replaced in its catalog and the other plugins, its name and its display name stay.

Before writing anything the command checks the package against the Agent Plugins 1.0.0 schemas and the directory rules: listing text limits, HTTPS listing links without credentials, square icons of 48 to 4096 px, skill headers, a single MCP server without headers, and no hooks, app references, tokens, private keys, local paths or, with `--public`, private network addresses and a display name ending in "MCP", "MCP Server" or "Plugin". Every problem is listed and nothing is written.

## Team or private deployment

Build against your server and add the output as a marketplace:

```bash
npx @structured-world/gitlab-mcp plugin build --endpoint https://mcp.example.com/mcp
codex plugin marketplace add ./gitlab-mcp-plugin
```

Then open the Plugins Directory in Codex or the ChatGPT desktop app, choose the **GitLab by Structured World** marketplace and install the plugin. Share the output directory, for example in a Git repository, so the team adds the same marketplace.

## Directory submission

```bash
npx @structured-world/gitlab-mcp plugin build --public \
  --endpoint https://mcp.example.com/mcp \
  --privacy-url https://example.com/privacy \
  --terms-url https://example.com/terms
```

Upload the ZIP in the OpenAI platform dashboard. The directory also requires a verified publisher and domain, review test cases, a reviewer account and a demo recording; those are entered in the dashboard, not packaged.

## See Also

- [Codex installation](/guide/installation/codex)
- [`gitlab-mcp install`](/cli/install), to register a local server in Codex instead
