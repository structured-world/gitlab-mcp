---
title: Issue Triage
description: "Prompts for triaging GitLab issues — prioritize, label, assign, and organize work items efficiently"
---

# Issue Triage

Organize, prioritize, and assign incoming issues efficiently.

## View Open Issues

> "Show me all open issues in `my-org/api`"

> "List issues created this week in `my-org/frontend`"

::: code-group

```json [All open issues]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": ["OPEN"],
  "types": ["ISSUE"],
  "first": 30,
  "simple": true
}
```

```json [Open tasks]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": ["OPEN"],
  "types": ["TASK"],
  "first": 20,
  "simple": true
}
```

:::

## Create Issues

> "Create an issue for the login timeout bug in `my-org/api`"

> "Add a task to update the documentation"

::: code-group

```json [Bug report]
{
  "action": "create",
  "namespace": "my-org/api",
  "workItemType": "ISSUE",
  "title": "Login timeout after 30 seconds of inactivity",
  "description": "## Steps to Reproduce\n1. Login to the application\n2. Wait 30 seconds\n3. Try to navigate\n\n## Expected\nSession should persist for 30 minutes\n\n## Actual\nUser is logged out after 30 seconds"
}
```

```json [Task]
{
  "action": "create",
  "namespace": "my-org/api",
  "workItemType": "TASK",
  "title": "Update API documentation for v2 endpoints",
  "description": "Update the API docs to reflect the new authentication flow added in MR !42"
}
```

:::

## Organize with Labels

> "List available labels in `my-org/api`"

> "Create a `priority::critical` label"

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
  "name": "priority::critical",
  "color": "#FF0000",
  "description": "Must be fixed immediately"
}
```

:::

## Assign and Prioritize

> "Assign issue #95 to @alice"

> "Add labels to the new bug report"

::: code-group

```json [Assign issue]
{
  "action": "update",
  "id": "5953",
  "assigneeIds": ["42"]
}
```

```json [Add labels]
{
  "action": "update",
  "id": "5953",
  "labelIds": ["101", "102"]
}
```

:::

## Close Issues

> "Close issue #95 — it's been fixed in MR !42"

```json [Close issue]
{
  "action": "update",
  "id": "5953",
  "state": "CLOSE"
}
```

## Triage Workflow

A systematic approach to incoming issues:

1. > "List issues without labels in `my-org/api`"
2. > "Show me issues without assignees"
3. > "What issues are not in any milestone?"
4. > "List issues with label `triage` that need categorization"

For each untriaged issue:
- Add appropriate labels (type, priority, component)
- Assign to the right team member
- Add to the current or next milestone
- Add weight/estimation if applicable

## Next Steps

- [Sprint Planning](/prompts/project-management/sprint-planning) — Plan your next sprint
- [Release Notes](/prompts/project-management/release-notes) — Generate changelogs
