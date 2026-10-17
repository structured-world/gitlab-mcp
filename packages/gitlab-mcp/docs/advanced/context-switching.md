---
title: Context Switching
description: "How GitLab MCP binds a connection to one GitLab instance in static token and OAuth modes, how to work with another instance, and what manage_context changes within a chat."
head:
  - - meta
    - name: keywords
      content: context switching, instance switching, OAuth, static token, manage_context, presets, scope, MCP
---

# Context Switching

A connection to GitLab MCP works with one GitLab instance. Within it, `manage_context` changes the preset and the scope of the current chat.

## Which instance a connection uses

| Mode | Instance | To use another instance |
|------|----------|-------------------------|
| Static token | `GITLAB_API_URL` (or the host of the profile in `GITLAB_PROFILE`), fixed when the server starts | Register a second server entry with its own URL and token |
| OAuth | The instance the user signs in to | Sign in again and choose the other instance |

### Static token mode

The server uses one token for one instance for its whole lifetime. To work with several instances, register one server entry per instance in the client, each with its own `GITLAB_API_URL` and `GITLAB_TOKEN`, under different names. The tools of each entry act only on its instance.

### OAuth mode

When the server is configured with several instances, the sign-in page lists them by label and address, and the user picks one. The session and its tokens belong to that instance, since a token issued by one GitLab is not accepted by another. To work with another instance, disconnect the server in the client, connect again and choose the other instance on the sign-in page.

To be signed in to two instances at once, add the server to the client twice under different names; each entry signs in separately and is offered the sign-in page, where you choose its instance:

```bash
codex mcp add gitlab-corp --url https://mcp.example.com/mcp
```

The client keeps the sign-in of each entry apart and names the tools by the entry, so a chat sees both sets of tools and each acts on its own instance. A plugin provides one entry, so the second one is added this way next to it.

See [Multi-Instance Setup](/guide/multi-instance) for configuring the instance list.

## Changing the context of a chat

`manage_context` changes how the current chat works with the instance; it never changes the instance itself.

| Action | Effect |
|--------|--------|
| `show` | Current instance, preset, scope and read-only state |
| `whoami` | The signed-in account, token scopes and the tools they allow |
| `list_presets` | Available presets |
| `switch_preset` | Use another preset in this chat |
| `set_scope` / `clear_scope` | Limit this chat to a project or group, or lift the limit |
| `reset` | Return this chat to the state it started with |

```json
// manage_context
{
  "action": "switch_preset",
  "preset": "readonly"
}
```

A preset or scope chosen this way applies to the current chat only. Account settings, changed on the settings page or with the settings tools, apply to every chat of the account except where a chat chose otherwise; see [Account settings](/configuration/settings).

## Tool availability

The tool list follows the instance a connection works with: its version, its tier and the scopes of the token. When the token's permissions or the connection state change, the server sends `tools/list_changed` and clients fetch the new list.

The server supports GitLab 16.0 and later. Where an older instance lacks newer API surface, tools fall back to an equivalent it does have; only actions GitLab itself cannot perform there are hidden (and refused if called), for example:

| GitLab Version | Work items |
|----------------|------------|
| 18.1+ | All actions, using namespace-level queries |
| 16.4 - 18.0 | All actions; listing goes through project or group queries, as does lookup by IID where the namespace query is missing |
| 16.0 - 16.3 | All actions except `add_link` / `remove_link` |

Features that depend on a group's tier, such as epics or iterations, are checked per namespace; see [Tier Detection](/advanced/tier-detection).

## Related Documentation

- [Multi-Instance Setup](/guide/multi-instance) - Getting started guide
- [Federation Architecture](/advanced/federation) - Technical deep dive
- [Tier Detection](/advanced/tier-detection) - Namespace tier detection
- [Configuration Reference](/configuration/instances) - Configuration options
