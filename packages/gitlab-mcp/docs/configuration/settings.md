---
title: Settings
description: "Per-account and per-chat settings for GitLab MCP Server: working preset, read-only mode, default project or group, and tool groups. Changed from the client's settings page, the connection panel, or with tools."
head:
  - - meta
    - name: keywords
      content: settings, preset, read-only, scope, tool groups, manage_context, update_settings, MCP App
---

# Settings

Each GitLab account that uses the server has its own settings, and each chat can change
them for itself. Settings only narrow what the server administrator allows; they never
widen it.

## Three layers

| Layer   | Who sets it                                                              | Applies to                            | Kept                              |
| ------- | ------------------------------------------------------------------------ | ------------------------------------- | --------------------------------- |
| Server  | Administrator: environment variables and startup presets                 | Everyone                              | Server configuration              |
| Account | The user, with `update_settings` or the client's settings page           | Every new chat of that GitLab account | Durably (see [Storage](#storage)) |
| Chat    | The user or the assistant, with `manage_context` or the connection panel | The current chat only                 | Until the chat ends or is reset   |

The account is the GitLab user behind the connection: with OAuth, the user who signed in;
with a static token, the token's instance. Two users of one server never see each other's
settings, and a chat override never leaks into another chat.

## What can be set

| Setting                 | Effect                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `preset`                | A working preset from the server's presets, or `none`                                                                            |
| `readOnly`              | Tools that change GitLab are off. Cannot be turned off when the administrator enabled read-only mode.                            |
| `scope`                 | A project or group path to work in; empty to work everywhere you have access                                                     |
| `scopeIncludeSubgroups` | With a group scope, whether projects in its subgroups are included                                                               |
| `tools_<group>`         | Turn a tool group off or on, for example `tools_wiki` or `tools_pipelines`. Groups the administrator turned off are not offered. |

The effective restrictions combine all layers: a chat value replaces the account value for
that chat. Read-only mode set by the server administrator or by the selected preset always
applies; a chat cannot turn it off.

Restrictions are applied when a tool runs, not only to the tool list: a direct call to a
tool the settings turn off, or to a project or group outside the working scope, is refused
before anything reaches GitLab. A scope of projects reaches no group, so group operations
are refused under it. A project or group named by its numeric id is checked as the path
GitLab reports for it.

A listing or search that names no project or group reads the working scope instead of
everything the account can see: a global search becomes a search of the scope's group or
project, a project listing lists the scope's group (or the scope's own projects), a
cross-project merge request listing and a vulnerability listing name the scope's target.
Results that cannot be filtered at GitLab (project listings and searches, including
projects only shared with the scope's group, todos, merge requests under a group scope)
are filtered to the scope, reading further GitLab pages until the requested page is full
(up to 1000 rows per call; a page still short then comes back marked `partial`, with a hint
to narrow the listing). Your own activity (`browse_events` with `action: "user"`) shows the
scope project's events under a project scope and is refused under a group scope.
Instance-wide listings read the scope instead: deploy keys and instance audit events those
of the scope project, all or owned runners those available to the scope's project or group;
where the scope has no such form, the listing is refused. A global search or vulnerability
listing is refused under a scope of several projects or groups, and under a group scope
without subgroups (GitLab's group results always include them); use one project or group
instead. A global search for projects under a project scope answers with the scope's
projects that match; a search of snippet titles, which GitLab offers only instance-wide, is
refused under any scope. An action the administrator denied stays denied when the scope
runs other requests in its place. `manage_todos mark_all_done` marks only the scope's pending todos done and leaves
the others pending. A project created or forked without a namespace goes into the scope's
group; with no single group to put it in, and for a group without a parent, the call is
refused.

The working scope is a focus, not an access boundary: the user sets and clears it. Calls
that name an object only by its global id (a work item or todo id) are not checked against
the scope. To limit what the server can reach, give it a project or group access token;
GitLab enforces that on every call.

## Changing settings

### Clients with a settings page

Clients that render server settings natively (for example Codex) show the account settings
as a settings page for the connection. The server advertises it with the `openai/settings`
capability; the page reads `get_settings` and saves with `update_settings`.

### The connection panel

Clients that support MCP Apps show the connection panel when the `open_settings_panel`
tool runs. In the panel you can:

- search your projects and groups and choose where to work, for this chat
  (**Use in this chat**) or as the default for new chats (**Save for new chats**), or let
  this chat work everywhere (**Work everywhere in this chat**; the default for new chats and
  the chat's preset and read-only mode stay);
- see what the current chat can do: preset, read-only mode and tool groups that are off;
- check the connection: account, GitLab version and tier, available tools, and what to do
  about problems such as an expired sign-in.

The panel loads nothing from the network and calls only this server's tools through the
client, with your own authorization. Success is reported from the settings the server
holds after saving, not from the request.

### Any client

Every setting can also be changed with tools, so clients without a settings page or app
panels, and the assistant itself, can use them:

```json
// get_settings: current values and what each can be set to
{}

// update_settings: change only the listed settings for new chats
{ "set": { "scope": "my-group", "scopeIncludeSubgroups": true, "tools_wiki": false } }

// manage_context: change only this chat
{ "action": "set_scope", "namespace": "my-group/my-project" }
{ "action": "clear_scope" }
{ "action": "switch_preset", "preset": "readonly" }
{ "action": "reset" }
```

`update_settings` validates every value before saving anything; an invalid value saves
nothing. `manage_context clear_scope` lets the chat work everywhere the account has access,
also when the account has a default scope; its preset and read-only mode stay.
`manage_context reset` drops all of the chat's overrides, so the chat uses the account
settings again.

`check_connection` reports the account, the instance, the restrictions in effect and
recommendations, and `find_scope_targets` finds projects and groups to scope to.

## Storage

| Deployment                                                                         | Account settings are kept in                                                                                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth with PostgreSQL session storage                                              | The session storage, shared by every replica that uses it                                                                                                                   |
| OAuth with file session storage                                                    | The session storage file. File storage serves one server process: replicas need PostgreSQL                                                                                  |
| OAuth with sessions in memory (the default), or a local server with a static token | `~/.config/gitlab-mcp/settings/` of the user running the server, shared by every server process of that user; settings survive a restart even though memory sessions do not |

Writes are compare-and-set: two chats editing different settings at the same time both
keep their change. Chat overrides are held by the server process that serves the chat.
The local settings directory keeps each saved state as a new numbered file, created only if
no other process saved that number first, so there is no lock: a server process that stops
or is suspended mid-write never blocks the others or overwrites newer settings.

If a saved preset is later removed from the server, chats that use it work read-only until
another preset is chosen, and `check_connection` reports it.

## Updates in open chats

When settings change, the server sends `tools/list_changed` to the chats they affect, so
clients refresh the tool list. With several replicas, only chats served by the replica that
saved the change are notified; chats on other replicas apply the new settings from their
next request, but their clients refresh the tool list only on their next list request.

## Related Documentation

- [Read-Only Mode](/security/read-only) - Server-wide read-only mode
- [Context Switching](/advanced/context-switching) - Switching GitLab instances
- [Instance Configuration](/configuration/instances) - Configuring GitLab instances
