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

| Layer   | Who sets it                                                              | Applies to                                                                                  | Kept                              |
| ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------- |
| Server  | Administrator: environment variables and startup presets                 | Everyone                                                                                    | Server configuration              |
| Account | The user, with `update_settings` or the client's settings page           | Every chat of that GitLab account, open ones at once, except where the chat chose otherwise | Durably (see [Storage](#storage)) |
| Chat    | The user or the assistant, with `manage_context` or the connection panel | The current chat only                                                                       | Until the chat ends or is reset   |

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

The tool list follows the same restrictions: tools they turn off are not listed, and actions
the preset denies are left out of a tool's schema (a tool whose every action is denied is
not listed).

Restrictions are applied when a tool runs, not only to the tool list: a direct call to a
tool the settings turn off, or to a project or group outside the working scope, is refused
before anything reaches GitLab. A scope of projects reaches no group, so group operations
are refused under it. A project or group named by its numeric id is checked as the path
GitLab reports for it.

A listing or search that names no project or group reads the working scope instead of
everything the account can see: a global search becomes a search of the scope's group or
project, a project listing lists the scope's group (or the scope's own projects, leaving
archived ones out as a plain listing does), a cross-project merge request listing and a
vulnerability listing name the scope's target (the merge request listing still shows your
own merge requests, as the cross-project one does, unless `scope` names another set). A preset scope of one project or group,
whether named alone, as a list of one or as a namespace, is that single target.
Results that cannot be filtered at GitLab (project listings and searches, including
projects only shared with the scope's group, todos, merge requests under a group scope,
namespace listings) are filtered to the scope, reading further GitLab pages until the requested page is full
(up to 1000 rows per call; a page still short then comes back marked `partial`, with a hint
to narrow the listing). Your own activity (`browse_events` with `action: "user"`) shows the
scope project's events under a project scope. For groups or multiple targets it filters
your feed by project paths, resolving at most 100 distinct project IDs per call; a lookup
bound makes the answer explicitly partial.
Instance-wide listings read the scope instead: deploy keys the deduplicated keys of the
scope's projects, those it names and those of its groups (at most ten group project pages
and ten key requests in total, with incomplete results marked partial),
instance audit events the trails of the scope's projects and groups (see below),
all runners those available to the scope's project or group, and your own runners those of
yours the scope's project or group can use; where the scope has no such form, the listing is
refused. A namespace listing is refused under a scope of projects, which reaches no group.

Under several targets, a project listing and a cross-project merge request listing read each
target's own listing, merge them without repeats in GitLab's order (newest created first
unless `order_by`/`sort` name another) and page the result, within ten requests; a page left
short by that bound is marked `partial`. A project of the scope answers a project listing
itself when the call uses only `search`, `simple`, `order_by` and `sort`; with other options
the account's project listing is filtered to the scope instead. A `similarity` or `priority`
order ranks rows within one listing only, so the targets keep their order and the page is
marked `partial`.

For several project/group targets, runner feeds keep their original filters and cursor,
intersected with the union of runners available to those targets. The availability scan
shares ten connection requests across the whole scope; an incomplete scan is reported as
`partial`. Targetless vulnerability listings compose the targets' connections, filter
each finding by its project, deduplicate, and sort before returning the requested page.
They share the same ten-request/1000-row bound. Their `scope:` cursor is bound to the
scope and filters, works across server replicas, and must be restarted after either
changes. If the bound prevents a complete scan, the sorted result is marked `partial`;
narrow the scope for a complete listing. No snapshot is retained between calls.
For deploy keys, explicit `public: false` follows the ordinary scoped listing, just
like omitting it; `public: true` remains an instance-wide operation.
Instance audit events under a group or several targets merge the trails newest first and
page the result, reading each trail only as far as the page needs within the same ten
requests. GitLab keeps a group's trail to the group's own events, so a group is read with
the trails of its projects and of the subgroups on the way to them (its projects listed up
to 1000). An unread trail marks the page `partial`, and so does a scope that includes
subgroups: a subgroup that holds no project is not found through its projects. Under any
scope, one project too, an audit listing filtered by entity reads the same trails: `Project`
or `Group` keeps the trails of that kind of place, `entity_id` with it reads that one
project's or group's trail when it is in the scope, and `User` or `Gitlab::Audit::InstanceScope`
answers an empty page, as those events are in no trail of the scope.

A numeric project or group identifier selected as a scope is saved as its canonical
GitLab path; projects and groups are numbered separately, so an identifier that names both
is refused, to be given by path. A URL-encoded path is accepted and saved decoded. A project listing or search under a scope made of projects is ordered as GitLab
orders it (newest created first unless `sort`/`order_by` name another order) before
pagination, reading at most 1000 scope projects; missing ordering metadata, a `similarity`
order (GitLab's own ranking) or unread projects are reported as partial rather than
implying a complete ordered page.
A project snippet listing that names no project lists the scope project's snippets, or under a
group or several targets the snippets of the scope's projects, merged newest first within the
same ten requests and marked `partial` when some were not read; public
snippets, listed only across the whole instance, and personal snippets, which belong to no
project, are refused under any scope, as is a listing of personal access tokens, which belong to
an account rather than a project or group. Under a group scope without subgroups, a search and a vulnerability listing, global
or naming the group, read the group's results kept to the group itself and its direct projects (GitLab's group
results always include subgroups; a user search keeps the group's members, its own and those
inherited from its parent groups). The group's own
projects are read up to 1000; a search of a larger group comes back marked `partial`. Under
several targets, a global search of issues, merge requests, milestones, notes, wiki pages,
commits, code or users searches each target, merges the results without repeats and pages
them, within ten requests (groups without their subgroups list their direct projects within
eleven more, shared by all of them, and a group not fully listed is marked `partial`); issues and merge requests follow `order_by`/`sort` (newest created
first by default) and milestones newest updated first, while the other kinds keep target
order and are marked `partial`. A global search of projects there is refused unless the
scope is made of projects. A global search for projects under a project scope answers with
the scope's active projects whose name, path or description match; a global search for
groups answers with the scope's groups that match, newest first or oldest first with
`sort: asc` (an `updated_at` ordering cannot be reproduced and is marked `partial`), and is
refused under a scope of projects, which reaches no group. A search of snippet titles, which
GitLab offers only instance-wide, answers under any scope with the snippets of the scope's
projects that GitLab's search matches (every word of three or more characters in the title,
description or file name), newest updated first, read within the same ten requests and marked
`partial` when some were not read. An action the administrator or the preset denied
stays denied when the scope runs other requests in its place. A scope made of many projects is read a few
projects at a time. `manage_todos
mark_all_done` marks only the scope's pending todos done and leaves the others pending, reading
the todos of each project and group of the scope. One call marks at most 100 of them; when
more remain the result is marked `partial`, and calling it again continues. A group without
its subgroups also reads its subgroups' todos; past each group's first page at most 1000 more
are read, shared by all such groups, and the rest is marked `partial`. One call reads the
projects and groups of the scope one after another within 50 requests (each costs a lookup
and at least one page of todos); those it did not reach are named in a `partial` result, to
be narrowed. A project created or forked without a namespace goes into the scope's
group; with no single group to put it in, and for a group without a parent, the call is
refused. A snippet created without a project goes into the scope's project; under any other
scope it would be a personal snippet, and the call is refused.

The working scope is a focus, not an access boundary: the user sets and clears it. Calls
that name an object only by its global id (a work item or todo id) are not checked against
the scope. A user search (`browse_users`) stays the instance's user directory, so people who
are not yet members of the scope can be found to add, assign or mention; a global search of
users finds the scope's members. To limit what the server can reach, give it a project or
group access token; GitLab enforces that on every call.

## Changing settings

### Clients with a settings page

Clients that render server settings natively (for example Codex) show the account settings
as a settings page for the connection. The server advertises it with the `openai/settings`
capability; the page reads `get_settings` and saves with `update_settings`.

### The connection panel

Clients that support MCP Apps show the connection panel when the `open_settings_panel`
tool runs; the server declares the `io.modelcontextprotocol/ui` extension for it. In the
panel you can:

- search your projects and groups and choose where to work, for this chat
  (**Use in this chat**) or as the account's default for all chats (**Save for all chats**;
  a chat that chose its own place keeps it), or let this chat work everywhere (**Work
  everywhere in this chat**; the account's default and the chat's preset and read-only mode
  stay);
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

// update_settings: change only the listed settings, for all chats of the account
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
| OAuth with PostgreSQL session storage                                              | The session storage database                                                                                                                                                |
| OAuth with file session storage                                                    | The session storage file                                                                                                                                                    |
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
clients refresh the tool list. Every call reads the settings as they are stored, so it
always runs under the current ones.

## Related Documentation

- [Read-Only Mode](/security/read-only) - Server-wide read-only mode
- [Context Switching](/advanced/context-switching) - Which instance a connection uses
- [Instance Configuration](/configuration/instances) - Configuring GitLab instances
