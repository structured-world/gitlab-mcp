---
title: Antigravity CLI
description: Connect Antigravity CLI to GitLab MCP and reproduce the installed-client result qualification.
---

# Antigravity CLI

Antigravity CLI (`agy`) is Google's successor to Gemini CLI. Configure GitLab MCP
in your workspace's `.agents/mcp_config.json`:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp@latest", "stdio"],
      "env": {
        "GITLAB_API_URL": "https://gitlab.com",
        "GITLAB_TOKEN": "<your-token>"
      }
    }
  }
}
```

Use Node.js 24 or later. Set your GitLab instance URL and token as described in
[authentication](/guide/authentication). Keep credentials out of version control.
The setup wizard does not currently detect or configure AGY automatically.

For an existing HTTP deployment, use `serverUrl` instead of `command`, `args` and
`env`. See [remote deployment](/deployment/) for the server configuration.

AGY's global MCP configuration is `~/.gemini/config/mcp_config.json`. Its CLI
preferences are a separate file, `~/.gemini/antigravity-cli/settings.json`.
For migration from Gemini CLI, follow Google's
[migration guide](https://antigravity.google/docs/cli/gcli-migration/).
Copy only the servers you intend to use and avoid configuring the same server
in both workspace and global configuration.

## JSON lists and structured results

GitLab MCP's entity tools return JSON in a text content block. A list can be `[]`
or an array of entities. The optional MCP `structuredContent` field has a different
contract: it must be an object. Tools that explicitly declare structured output,
such as `get_profile`, retain that object and their output schema. See the
[MCP tool result specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content).

Installed-client qualification on October 30, 2026 used AGY **1.4.10**, macOS arm64
and Node.js **26.8.1**, with a locally built core package and MCP SDK **1.32.2**.
The server connected to a synthetic GitLab HTTP fixture. A scripted loopback Gemini
endpoint supplied tool calls, so the run used no real credentials or model inference.

| Scenario                | Server MCP validation          | AGY result                      | Gemini CLI Core 0.66.0 transport       |
| ----------------------- | ------------------------------ | ------------------------------- | -------------------------------------- |
| Empty MR list           | Valid text `[]`                | Preserved                       | Adds invalid array `structuredContent` |
| One MR                  | Valid text array               | Preserved, all fields unchanged | Adds invalid array `structuredContent` |
| Project object          | Valid text object              | Preserved                       | Valid object `structuredContent`       |
| Account profile         | Valid native structured object | Text preserved                  | Native envelope preserved              |
| GitLab permission error | Valid `isError` result         | Preserved as a tool error       | Valid error envelope                   |

The historical behavior was reproduced using the actual integrity-checked published
`@google/gemini-cli-core@0.66.0` transport. The current AGY path passed both list
cases. Existing Codex and Claude Code text results remain unchanged.

If an old Gemini CLI reports that array `structuredContent` is invalid, migrate to
the current AGY client. AGY's `stream-json` tool output is a client display result,
not a second MCP envelope. The qualification validates the original MCP envelope
and the historical transport's modified envelope with the SDK, then independently
checks AGY's decoded output and the subsequent provider tool response.

## Repeat the qualification

From a repository checkout with dependencies installed:

```bash
yarn workspace @structured-world/gitlab-mcp qualify:antigravity --report /tmp/antigravity-results.json
```

The command builds and packs the core package, installs the archive in a temporary
workspace, downloads the current official native AGY release and verifies its
SHA-512 checksum. It also verifies the pinned historical Gemini archive's npm
integrity. Each scenario gets its own client home, workspace MCP configuration
and allow rules for the selected read-only tool. Your existing client settings
and authentication are not imported.

The JSON report records versions, archive checksums, selected tools and arguments,
server wire messages, SDK validation failures from the historical client,
AGY transcripts and provider responses. Temporary binaries, dependencies and client
profiles are removed after the report is written. Build output follows the
repository's normal build lifecycle.

The native qualification command supports macOS and Linux. This result qualifies
stdio and the synthetic scenarios above; it does not qualify every transport or
replace testing against your GitLab instance. Downloads require network access;
all GitLab and provider traffic in the scenarios stays on loopback. No external
model credentials are needed.
