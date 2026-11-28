---
title: Project Management Tools
description: "GitLab project management tools — work items, milestones, labels, and iteration tracking via MCP"
head:
  - - meta
    - name: keywords
      content: GitLab project management, work items, issues, epics, milestones, labels, team members, MCP
---

# Project Management Tools

Work items, milestones, labels, and team collaboration tools.

## Tools Overview

| Tool | Type | Purpose |
|------|------|---------|
| `browse_work_items` | Query | List and get issues, epics, tasks, and their discussions |
| `manage_work_item` | Command | Create, update, delete work items |
| `browse_milestones` | Query | Milestone tracking and burndown |
| `manage_milestone` | Command | Create, update, delete milestones |
| `browse_labels` | Query | List and get labels |
| `manage_label` | Command | Create, update, delete labels |
| `browse_members` | Query | Team member information (projects and groups) |
| `manage_member` | Command | Add/remove team members |

## Work Items

GitLab work items include Issues, Epics, Tasks, Incidents, and more.

### browse_work_items

<!-- @autogen:tool browse_work_items -->
| Action | Description |
|--------|-------------|
| `list` | List work items with filtering |
| `get` | Get single work item details |
| `list_discussions` | Read work item comments, replies, and system notes |
| `list_types` | List the work item types of a namespace with the widgets each supports |
| `list_saved_views` | List the saved work item views of a namespace that you can see |
| `get_saved_view` | Read a saved view's filters, sort and a page of the work items it shows |
<!-- @autogen:end -->

::: code-group

```json [List issues]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": ["OPEN"],
  "types": ["ISSUE"],
  "first": 20,
  "simple": true
}
```

```json [Filter issues]
{
  "action": "list",
  "namespace": "my-org/api",
  "types": ["ISSUE"],
  "search": "login timeout",
  "label_names": ["bug"],
  "assignee_usernames": ["alice"],
  "sort": "UPDATED_DESC",
  "first": 20
}
```

```json [Children of an item]
{
  "action": "list",
  "namespace": "my-org/api",
  "parent_ids": ["5953"]
}
```

```json [Types and widgets]
{
  "action": "list_types",
  "namespace": "my-org/api"
}
```

```json [Saved views]
{
  "action": "list_saved_views",
  "namespace": "my-org",
  "subscribed_only": true
}
```

```json [Items of a saved view]
{
  "action": "get_saved_view",
  "namespace": "my-org",
  "view_id": "42",
  "first": 20
}
```

```json [List epics]
{
  "action": "list",
  "namespace": "my-org",
  "state": ["OPEN"],
  "types": ["EPIC"],
  "first": 20,
  "simple": true
}
```

```json [Get by ID]
{
  "action": "get",
  "namespace": "my-org/api",
  "id": "5953"
}
```

```json [Get by IID]
{
  "action": "get",
  "namespace": "my-org/api",
  "iid": "95"
}
```

```json [Read discussions]
{
  "action": "list_discussions",
  "namespace": "my-org/api",
  "iid": "95",
  "first": 10
}
```

:::

`list` filters on the server: GitLab applies them before paginating, so each page and
its `hasMore` describe matching items only. Continue with `endCursor` as `after`, keeping
the same filters and `sort`.

| Parameter | Matches | Applied by GitLab from |
|-----------|---------|------------------------|
| `search` | Text in the title or description | 16.0 |
| `author_username` | Items created by the user | 16.0 |
| `assignee_usernames` | Items assigned to all of the users | 17.2 |
| `label_names` | Items with all of the labels | 17.2 |
| `milestone_titles` | Items in any of the milestones | 17.2 |
| `parent_ids` | Direct children of the items (IDs from list results) | 18.1 |
| `sort` | `CREATED_DESC` (default), `CREATED_ASC`, `UPDATED_DESC`, `UPDATED_ASC`, `TITLE_ASC`, `TITLE_DESC` | 16.0 |

Every filter works from GitLab 16.0. On an older instance, the assignee, label,
milestone and parent filters are applied by the server while it reads GitLab's pages in
order, with the same matching rules. Such a call reads at most 1,000 work items; when
the page is still short, the result has `hasMore: true` and a `note`, and `endCursor`
continues the search. An item whose deciding labels or assignees are beyond the first
100 GitLab lists for it, or whose type lists no widget for a filter, is left out and
counted in the `note`. Where GitLab applies the assignee filter itself, it ignores a
username it cannot resolve, so when one of several is unknown each item is also checked
against all of them, and the `note` names the unknown ones. A filter that cannot be
applied either way is refused with its parameter name, and nothing is listed. The list
filters take up to 100 values each; `label_names` does not accept `None` or `Any`,
which GitLab reads as "no labels" and "any label" rather than as titles.
A group namespace lists the group's own work items, such as epics, not those of its
projects.

`list_types` returns the namespace's work item types with their `id`, `name` and, on
GitLab 16.7 and later, `widgets`: the widgets each type supports in that namespace,
which reflect the instance's license. A namespace that does not exist or is not
accessible is reported as an error rather than as an empty list.

`list_saved_views` and `get_saved_view` read GitLab's saved work item views, from
GitLab 18.9. `list_saved_views` returns the views of a namespace you can see (public
ones and your own private ones) with their `id`, `name`, `description`, `isPrivate`,
`subscribed`, `sort` and `shareUrl`; `search` matches the name or description and
`subscribed_only` keeps the views you are subscribed to. `get_saved_view` returns the
view with its stored `filters` and `displaySettings`, and a page of its work items
(`items`, `hasMore`, `endCursor`; pass `endCursor` as `after` for the next page of
the same view).

GitLab does not compute a view's items on the server, so `get_saved_view` lists them
with the view's filters and sort the way GitLab's work item list does: descendant
groups and projects included unless the view filters by group, every state unless the
view filters by state, and the types the list offers by default (GitLab 18.10+) unless
the view names types. `exact: false` means the items may differ from the view:
`unappliedFilters` names filters this instance cannot apply, `filterWarnings` passes
on GitLab's report of filter values that no longer exist (such as a deleted label),
and `note` explains each case; a view without a sort of its own is also inexact, as
GitLab's list would use your sort preference. A view that does not exist and one you
cannot see are reported the same way. A view that filters on a group or project you
cannot read, or one outside the working scope or the projects the server may read, is
an error rather than an empty page. When the working scope does not include a group's
subgroups, only the group's own work items are listed and the result is inexact.

`list_discussions` reads user comments and system activity from the GitLab notes widget.
Use `namespace` and `iid`, or the global `id`. Each discussion contains a `notes`
connection with the note body, author, timestamp and `system` flag. Use the
response's `endCursor` as `after` while `hasMore` is true.

Each thread also has its own `notes.pageInfo`. To continue a long thread, locate it
with `first: 1`, then repeat that same one-discussion page using the same `after`
(omit it for the first page). Supply the discussion's `id` as `discussion_id` and
`notes.pageInfo.endCursor` as `notes_after`. Both page sizes default to 10 and accept
1 to 20. Reduce `first` or `notes_first` if the response exceeds the 4 MiB limit.

:::info
Time tracking: when available, `browse_work_items` returns a `TIME_TRACKING` widget with fields like `timeEstimate` and `totalTimeSpent`. In `simple: true` mode, time tracking is included as a simplified widget.
:::

### manage_work_item

<!-- @autogen:tool manage_work_item -->
| Action | Description |
|--------|-------------|
| `create` | Create a new work item |
| `update` | Update an existing work item |
| `delete` | Delete a work item |
| `delete_timelog` | Delete a time tracking entry from a work item |
| `add_link` | Add a relationship link between two work items |
| `remove_link` | Remove a relationship link between two work items |
| `reorder` | Reorder an issue card without changing its list or hierarchy |
<!-- @autogen:end -->

::: code-group

```json [Create issue]
{
  "action": "create",
  "namespace": "my-org/api",
  "workItemType": "ISSUE",
  "title": "Fix login timeout",
  "description": "Session expires too quickly",
  "assigneeIds": ["42"],
  "labelIds": ["101"]
}
```

```json [Create epic]
{
  "action": "create",
  "namespace": "my-org",
  "workItemType": "EPIC",
  "title": "Q2 Platform Migration",
  "description": "Epic for all migration tasks"
}
```

```json [Close issue]
{
  "action": "update",
  "id": "5953",
  "state": "CLOSE"
}
```

:::

### Work Item Types

| Type | Namespace | Description |
|------|-----------|-------------|
| `ISSUE` | Project | Standard issues |
| `TASK` | Project | Sub-tasks |
| `EPIC` | Group | Cross-project themes |
| `INCIDENT` | Project | Production incidents |
| `TEST_CASE` | Project | QA test cases |
| `REQUIREMENT` | Project | Requirements tracking |

## Milestones

Track sprint progress and release planning.

### browse_milestones

<!-- @autogen:tool browse_milestones -->
| Action | Description |
|--------|-------------|
| `list` | List milestones with optional filtering |
| `get` | Get a single milestone by ID |
| `issues` | List issues assigned to a milestone |
| `merge_requests` | List merge requests assigned to a milestone |
| `burndown` | Get burndown chart data for a milestone |
<!-- @autogen:end -->

::: code-group

```json [Active milestones]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": "active",
  "per_page": 20
}
```

```json [Burndown chart]
{
  "action": "burndown",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 20
}
```

```json [Milestone issues]
{
  "action": "issues",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 50
}
```

:::

### manage_milestone

::: code-group

```json [Create milestone]
{
  "action": "create",
  "namespace": "my-org/api",
  "title": "Sprint 15",
  "start_date": "2025-02-03",
  "due_date": "2025-02-14"
}
```

```json [Close milestone]
{
  "action": "update",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "state_event": "close"
}
```

```json [Promote to group]
{
  "action": "promote",
  "namespace": "my-org/api",
  "milestone_id": "42"
}
```

:::

## Labels

Organize and categorize work items.

### Examples

::: code-group

```json [List labels]
{
  "action": "list",
  "namespace": "my-org/api",
  "per_page": 50
}
```

```json [Create label]
{
  "action": "create",
  "namespace": "my-org/api",
  "name": "priority::high",
  "color": "#FF0000",
  "description": "High priority items"
}
```

```json [Update label]
{
  "action": "update",
  "namespace": "my-org/api",
  "label_id": "priority::high",
  "color": "#CC0000"
}
```

:::

## Team Members

Manage project and group membership.

### Examples

::: code-group

```json [List members (browse_members)]
{
  "action": "list_project",
  "project_id": "my-org/api",
  "per_page": 50
}
```

```json [Add developer]
{
  "action": "add_to_project",
  "project_id": "my-org/api",
  "user_id": "42",
  "access_level": 30
}
```

```json [Change role]
{
  "action": "update_project",
  "project_id": "my-org/api",
  "user_id": "42",
  "access_level": 40
}
```

:::

### Access Levels

| Level | Role | Capabilities |
|-------|------|-------------|
| 0 | No access | No access to the project |
| 5 | Minimal | Read-only, minimal permissions |
| 10 | Guest | View issues, leave comments |
| 20 | Reporter | View code, create issues |
| 30 | Developer | Push code, create MRs |
| 40 | Maintainer | Merge MRs, manage settings |
| 50 | Owner | Full control |

## Related

- [Sprint Planning Prompts](/prompts/project-management/sprint-planning)
- [Issue Triage Prompts](/prompts/project-management/issue-triage)
- [Team Onboarding Guide](/guides/team-onboarding)
