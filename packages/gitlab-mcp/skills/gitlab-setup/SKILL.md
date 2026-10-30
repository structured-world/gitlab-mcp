---
name: gitlab-setup
description: Diagnose a GitLab MCP connection, selected account, token permissions, or missing tools in Codex or Claude Code. Use for GitLab setup and access problems, not unrelated application settings.
---

# GitLab connection and access

Use the installed GitLab MCP tools; their prefix depends on the host and connection name. Discover the available catalog rather than assuming a fixed prefix. Keep the user's selected account and namespace. Do not request tokens, passwords, cookies, or client secrets in conversation.

If the catalog exposes `gitlab_plugin_open_connection`, use it for initial setup,
reconnect or a requested connection change. Its private panel accepts either a GitLab
address for local core execution or an existing HTTP MCP endpoint. Wait for a verified
identity and refresh discovery before using backend tools. Never pass credentials
through chat or call the app-only connection mutation tool on the user's behalf.
The backend's settings and authorization remain authoritative after connecting.

1. Call `manage_context` with `{"action":"show"}` to identify the host, read-only mode, preset and namespace scope. This works while GitLab is disconnected.
2. Call `manage_context` with `{"action":"whoami"}` when available to inspect the connected identity, token permissions, expiry, instance version/tier and warnings. Report only what the response proves. An unavailable diagnostic is not proof of an invalid credential.
3. Explain the concrete cause: connection failure, insufficient permission, read-only policy, disabled feature, denied action, or unsupported instance capability. Distinguish these from an empty successful query.
4. If the installed catalog exposes settings or account-linking tools, use their declared interface for the requested setup. Otherwise direct the user to this connection's host-managed authentication/settings entry point. Do not invent a settings tool, edit global instructions, or place credentials in commands/files.
5. To change a requested preset, list the available choices first with `list_presets` and use the returned name. Change only the requested setting, then verify with `show` and refresh tool discovery. Another GitLab account or instance is reached by signing in to it through the host's connection settings; a chat cannot switch the account it is connected with. Context mutations can affect other sessions on existing shared servers; report this before a requested shared setting change.

Native structured context results use `{ "action": "...", "data": ... }`. The text content remains the previous JSON domain result for clients that consume text. Respect `isError`, including authentication metadata; a failed result is never successful setup. After a mutation times out, inspect the current context before considering another attempt.
