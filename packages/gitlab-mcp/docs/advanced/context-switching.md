---
title: Context Switching
description: "How one GitLab MCP connection works with several GitLab accounts and instances, for example a company GitLab and a personal GitLab.com account, and what manage_context changes within a chat."
head:
  - - meta
    - name: keywords
      content: context switching, multiple accounts, several GitLab instances, link account, switch account, OAuth, static token, manage_context, presets, scope, MCP
---

# Context Switching

One connection to GitLab MCP can work with several GitLab accounts, on one instance or on several, for example a company GitLab and a personal GitLab.com account. Each chat works with one of them at a time and switches with `manage_context`; other chats keep theirs.

## Accounts of a connection

| Mode | First account | More accounts |
|------|---------------|---------------|
| OAuth | The account the connection signed in with | Accounts linked from a chat with `link_account`, on any configured instance |
| Static token | `GITLAB_TOKEN` on `GITLAB_API_URL` | Each configured instance with its own token (`tokenEnv`) |

```json
// manage_context: the accounts of this connection, and which one this chat uses
{ "action": "list_accounts" }

// work with another account in this chat
{ "action": "switch_account", "account": "gitlab:..." }
```

After a switch, every call of the chat runs as that account on its instance, with its permissions, its account settings and the tools its instance's version and tier offer; the server sends `tools/list_changed` and the client fetches the new list. Other chats of the same connection are not affected, and a call already running finishes with the account it started with.

A chat's choice lasts as long as its MCP session and is held by the server process that serves it, like the chat's other overrides. A new session (after the server restarts, the session idles out, or the client reconnects) starts with the first account; check with `list_accounts` and switch again. The accounts themselves stay linked to the connection.

An account that cannot be used refuses the chat's calls with the reason and what to do; the chat never falls back to another account on its own. The account actions of `manage_context` keep working, so the chat can switch to another account or link this one again.

### Linking another account (OAuth)

```json
// manage_context
{ "action": "link_account", "instance": "https://gitlab.com" }
```

The result carries a sign-in link. A client that supports opening links for a server (MCP URL elicitation) may offer to open it for you; you can decline, and the link is returned either way. When the account is linked, the chat that started linking may receive a completion notification (best effort: it can be missed, for example when the chat has disconnected); `list_accounts` shows the new account in any case. In the browser, GitLab first confirms the account this connection signed in with, then you sign in with the account to link. The first step makes sure the person who asked for the link completes it: a link opened by someone else is refused, so nobody can attach their GitLab account to your connection or yours to theirs. The second step completes only in the browser that passed the first, so its sign-in page cannot be passed on either. The link works once and for 10 minutes. Without `instance` the account is linked on the connection's own instance. There the browser is still signed in as your own account after the first step, so the page stops with a continue button: sign out of GitLab in that browser (or switch to the account to link there), then continue in the same browser.

The instance must be configured on the server with its OAuth application (see [Instance Configuration](/configuration/instances)). Linked accounts are kept with the connection's session: they survive a server restart with file or PostgreSQL session storage, refresh their own GitLab tokens, and are removed with the session when the connection signs out or its session expires, their OAuth grants revoked at GitLab. Revoking a grant ends this server's access to the account; it does not sign anyone out of GitLab in their browser.

```json
// manage_context: remove a linked account and revoke its OAuth grant
{ "action": "unlink_account", "account": "gitlab:..." }
```

The account the connection signed in with cannot be unlinked, and a chat must switch away from an account before unlinking it.

Completing a link stores the account and spends the link together. The commit rejects a
callback whose session or account lease expired or was taken over by another request.
PostgreSQL deployments need matching core and DB package versions; account linking is
unavailable with a backend that lacks atomic link commits.

### Configured instances (static token)

A server started with a token can work with more instances when the instance configuration names a token for each. `GITLAB_TOKEN` belongs to the server's own instance, the one `GITLAB_API_URL` names (`https://gitlab.com` when it is not set); every other configured instance needs its own `tokenEnv`:

```bash
GITLAB_API_URL=https://git.company.com
GITLAB_TOKEN=glpat-company-token
GITLAB_COM_TOKEN=glpat-gitlab-com-token
```

```yaml
# GITLAB_INSTANCES_FILE
instances:
  - url: https://git.company.com
    label: Company GitLab
  - url: https://gitlab.com
    label: GitLab.com
    tokenEnv: GITLAB_COM_TOKEN
```

`list_accounts` lists the server's own instance and each configured instance whose token variable is set; `switch_account` takes the instance URL as the account id. Each instance is reached with its own token only.

See [Multi-Instance Setup](/guide/multi-instance) for configuring the instance list and the sign-in page.

## Changing the context of a chat

`manage_context` changes how the current chat works with its account.

| Action | Effect |
|--------|--------|
| `show` | Current instance, preset, scope and read-only state |
| `whoami` | The account, token scopes and the tools they allow |
| `list_presets` | Available presets |
| `switch_preset` | Use another preset in this chat |
| `set_scope` / `clear_scope` | Limit this chat to a project or group, or lift the limit |
| `reset` | Return this chat to the state it started with |
| `list_accounts` / `switch_account` | The accounts of the connection; work with another one in this chat |
| `link_account` / `unlink_account` | Link another account through the browser, or remove a linked one |

```json
// manage_context
{
  "action": "switch_preset",
  "preset": "readonly"
}
```

A preset or scope chosen this way applies to the current chat only. Account settings, changed on the settings page or with the settings tools, apply to every chat of the account except where a chat chose otherwise; each linked account has its own. See [Account settings](/configuration/settings).

## Tool availability

The tool list follows the account a chat works with: its instance's version and tier and the scopes of its token. When the chat switches accounts, or the token's permissions or the connection state change, the server sends `tools/list_changed` and clients fetch the new list.

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
