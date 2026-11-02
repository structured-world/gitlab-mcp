---
title: Codex Release Qualification
description: Verify a released GitLab MCP plugin in Codex desktop and Claude Code without confusing protocol checks with desktop acceptance.
---

# Verify a released Codex plugin

Use the [installation guide](/guide/installation/codex) for setup. This procedure
checks the installed release, both connection modes and the boundaries between
clients. A passing command-line check does not establish that desktop installation,
browser sign-in or native settings work.

## Prerequisites and evidence

Use the ZIP and checksum from the same GitHub release. Record the release tag,
ZIP SHA-256, operating system, Node version, desktop app version and Codex CLI
version. The configurable plugin requires Node.js 24 or later, including when
connecting to an existing HTTP server. The release ZIP includes its production
dependencies; the repository marketplace downloads the pinned npm runtime instead.

Use only a designated test project. Keep tokens in credential fields and test
configuration, never in prompts or screenshots. Remove private URLs, account names
and project data from screenshots before sharing them. Do not execute Duo flows
or consume credits as part of qualification.

For each check record `verified`, `failed`, or `not run or blocked`, with the
observed result. Keep desktop evidence separate from automated evidence. Record
the backend release as well as the plugin release when testing a remote server.

### Recorded automated check

On 2026-11-01, release `gitlab-mcp-v13.1.0` passed the package and native CLI
lifecycle checks below on macOS 27.0.1 with Node.js 26.8.1 and Codex CLI
`0.166.0-alpha.5.1`. Its ZIP SHA-256 was
`fcbd89cdfc70bf073981c0fbbda431f8508539cc896a2e769d1d306cc1e5692d`.

All 28 connection/authentication contracts passed. The separate live read-only
check returned the same account through local stdio and loopback HTTP.
Desktop UI acceptance and an independent production HTTP deployment were not
established by these checks. Repeat qualification for the next published artifact;
these results do not qualify the unreleased 13.2.0 package.

## Automated package and lifecycle checks

This qualification command requires Node.js 24+, workspace dependencies, a Codex
CLI executable and `unzip` available on `PATH`. The `unzip` requirement also applies
when running qualification on Windows; it is separate from extracting the release
ZIP through a desktop file manager.

Install [Corepack](https://yarnpkg.com/corepack), run `corepack enable`, and run
`yarn install --immutable` at the repository root first. This activates the Yarn
version declared by the repository.

From `packages/gitlab-mcp`:

```bash
yarn build
yarn qualify:codex-plugin --archive /path/to/gitlab-mcp-codex.zip --codex /path/to/codex
```

Place `gitlab-mcp-codex.zip.sha256` beside the ZIP. This verifies the checksum,
extracts the actual artifact, runs its connection/authentication contracts, and
uses the real Codex CLI in a temporary home for install, disable, enable, upgrade,
reinstall and uninstall. Unrelated Codex settings and seeded Claude configuration
must remain unchanged. The simulated upgrade stays inside that temporary home;
it does not publish a release or modify the input ZIP.

Optional read-only provider qualification uses the existing protected test configuration:

```bash
node --env-file=.env.test scripts/qualify-codex-plugin.mjs --archive /path/to/gitlab-mcp-codex.zip --live
```

It reads the GitLab profile through the installed runtime in local mode and through
a temporary loopback HTTP core, checks that the account agrees, then disconnects.
It does not verify an operator's production OAuth deployment or a desktop UI.

CI already checks the built archive, connection contracts, installed CLI lifecycle
and generated repository marketplace. Authenticated skill evaluations are separate:
see [workflow qualification](/guides/codex-workflows#verify-the-installed-workflows).

## Desktop acceptance

Follow the installation guide with a released archive. Use the app's Plugins
Directory to confirm installation, not a manually added MCP server alone.

1. **Installation:** confirm the plugin's name and release version. Check that no
   old standalone registration hides its server or duplicates tools. Open a fresh
   chat with the installed plugin enabled.
2. **Unconfigured startup:** open plugin settings and choose **Set up, change or
   reconnect GitLab**. The connection panel must open before a backend is configured.
3. **Local mode:** choose **GitLab instance, run MCP locally**, enter the test GitLab
   address and token in the panel, and connect. Verify the displayed account and
   instance. Ask to identify the account, find the test project and read its README.
4. **Remote mode:** choose **Existing GitLab MCP server** and enter the test endpoint.
   For OAuth, continue browser sign-in, authorize, then refresh status. Verify the
   account and repeat the project read. Record denied sign-in separately: it must
   not replace a previously saved connection or expose provider response bodies.
5. **Backend settings:** inspect account defaults, choose a project scope for this
   chat, and enable read-only mode. Read the chosen project. A requested mutation
   must be refused before it changes GitLab. Reset the chat and verify that account
   defaults are restored. Use only disposable test data for authorized write checks.
6. **Normal work:** inspect a test MR and its discussions, read a work item and
   inspect a failed pipeline with bounded job logs. Check that the selected project
   and account stay correct throughout. Do not repeat an uncertain write.
7. **Recovery:** cancel an unfinished replacement, reconnect the saved connection,
   restart the app and read the project again. Test invalid credentials and
   insufficient scopes with dedicated test credentials. Use the
   [connection diagnostics](/guides/codex-workflows#structured-diagnostics-and-failures)
   and restore the working connection through the panel.
8. **Two clients:** keep Codex and Claude Code connected to the same backend.
   Select a different chat scope or linked account in one session and verify that
   the other keeps its own selection. Verify standalone Claude stdio separately.
   Account defaults deliberately apply across clients using that account unless a
   chat overrides them; connection-panel selection is shared by this user's local
   plugin processes. These shared settings are not isolation failures.
9. **Lifecycle:** install the next released version and reconnect. Check identity
   and settings again. Disable the plugin, then enable it and repeat a read. Before
   uninstalling, disconnect if saved credentials should be erased. Remove the
   plugin and confirm that its tools disappear while Claude configuration remains.

Capture the plugin/version screen, connected panel, backend settings and one
successful test-project read. Do not manufacture desktop screenshots from a browser
preview or treat the CLI lifecycle as desktop acceptance.

## Surface and runtime boundaries

| Surface | What to verify | Boundary |
| --- | --- | --- |
| Codex desktop, configurable plugin | Both connection modes, panel, settings, real reads, lifecycle | Requires Node.js 24+ and local access to the selected backend |
| Codex CLI, installed plugin | Artifact installation, MCP discovery and lifecycle | Does not prove desktop panel rendering or browser sign-in |
| Codex standalone MCP | Registration and normal GitLab tools | Does not install the configurable plugin |
| Claude Code | Existing stdio/HTTP setup and normal workflows | Claude Channels remain specific to Claude Code |
| Claude Desktop MCPB | Install its separate release bundle and exercise MCP | Codex ZIP and MCPB are different artifacts |
| Codex cloud or ChatGPT web | Qualify independently if advertised | A local stdio plugin is desktop-only |

Run deterministic protocol tests for GitLab 16.0 separately from a current real
test instance. For replicated remote deployments, verify session storage and
account isolation on the shared backend; a single local process is not an HA test.
No platform or surface is verified merely because another row passed.
