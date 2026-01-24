# Project Management Tools

Work items, milestones, labels, and team collaboration tools.

## Tools Overview

| Tool | Type | Purpose |
|------|------|---------|
| `browse_work_items` | Query | List and get issues, epics, tasks |
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

:::

### manage_work_item

<!-- @autogen:tool manage_work_item -->
| Action | Description |
|--------|-------------|
| `create` | Create a new work item |
| `update` | Update an existing work item |
| `delete` | Delete a work item |
| `add_link` | Add a relationship link between two work items |
| `remove_link` | Remove a relationship link between two work items |
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
