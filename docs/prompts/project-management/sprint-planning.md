---
title: Sprint Planning
description: "Prompts for sprint planning with GitLab — create milestones, assign issues, and plan iterations"
head:
  - - meta
    - name: keywords
      content: gitlab sprint planning, milestones, iterations, burndown chart, sprint lifecycle, agile planning, issue assignment
---

# Sprint Planning

Use GitLab MCP for milestone management, sprint planning, and iteration tracking.

## View Current Milestones

> "Show me active milestones in `my-org/api`"

> "What milestones are coming up in the `my-org` group?"

::: code-group

```json [Active milestones]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": "active",
  "per_page": 20
}
```

```json [All milestones]
{
  "action": "list",
  "namespace": "my-org",
  "per_page": 20
}
```

:::

## Create a Sprint Milestone

> "Create a milestone 'Sprint 15' for `my-org/api` starting next Monday"

> "Set up milestone 'v2.1' with a two-week deadline"

```json [Create milestone]
{
  "action": "create",
  "namespace": "my-org/api",
  "title": "Sprint 15",
  "description": "Focus: Auth refactor and API performance",
  "start_date": "2025-02-03",
  "due_date": "2025-02-14"
}
```

## View Sprint Progress

> "Show me issues in milestone 'Sprint 14'"

> "What MRs are associated with milestone 'v2.0'?"

::: code-group

```json [Milestone issues]
{
  "action": "issues",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 50
}
```

```json [Milestone MRs]
{
  "action": "merge_requests",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 50
}
```

```json [Burndown data]
{
  "action": "burndown",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 20
}
```

:::

## Group Iterations (Premium)

> "Show me the current iteration in `my-org`"

> "What's upcoming in our sprint cadence?"

::: code-group

```json [Current iteration]
{
  "group_id": "my-org",
  "state": "current",
  "per_page": 5
}
```

```json [Upcoming]
{
  "group_id": "my-org",
  "state": "upcoming",
  "per_page": 5
}
```

:::

## Manage Sprint Lifecycle

> "Close milestone 'Sprint 14' — it's complete"

> "Update the due date for 'v2.0' to next Friday"

::: code-group

```json [Close milestone]
{
  "action": "update",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "state_event": "close"
}
```

```json [Update dates]
{
  "action": "update",
  "namespace": "my-org/api",
  "milestone_id": "43",
  "due_date": "2025-02-28"
}
```

:::

## Sprint Planning Workflow

1. > "Show me closed issues from the last sprint that weren't completed"
2. > "Create a new milestone 'Sprint 15' for next two weeks"
3. > "List unassigned issues with label 'priority::high'"
4. > "What's the team's current workload — show open MRs per person"

## Next Steps

- [Issue Triage](/prompts/project-management/issue-triage) — Organize incoming issues
- [Release Notes](/prompts/project-management/release-notes) — Generate changelogs
