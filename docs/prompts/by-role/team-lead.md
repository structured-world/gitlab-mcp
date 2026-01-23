# Team Lead Prompts

Team management, code reviews, sprint oversight, and workload balancing.

## Team Overview

> "Who are the members of `my-org/api` and their access levels?"

> "Show me the activity of my team members this week"

::: code-group

```json [Team members]
{
  "action": "list_project",
  "project_id": "my-org/api",
  "per_page": 50
}
```

```json [All members (inherited)]
{
  "action": "list_all_project",
  "project_id": "my-org/api",
  "per_page": 50
}
```

:::

## Review Queue Management

> "Show me all open MRs that haven't been reviewed yet"

> "Which MRs have been open the longest?"

> "List MRs with unresolved discussions"

::: code-group

```json [Unreviewed MRs]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "opened",
  "order_by": "created_at",
  "sort": "asc",
  "per_page": 20
}
```

```json [Draft MRs]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "opened",
  "wip": "yes",
  "per_page": 20
}
```

```json [By author]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "opened",
  "author_username": "alice",
  "per_page": 20
}
```

:::

## Sprint Tracking

> "What's the progress on milestone 'Sprint 14'?"

> "Show me unfinished issues in the current sprint"

> "How many issues were closed vs opened this week?"

::: code-group

```json [Sprint issues]
{
  "action": "issues",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 50
}
```

```json [Sprint burndown]
{
  "action": "burndown",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 20
}
```

:::

## Team Member Management

> "Add @bob as a developer to `my-org/api`"

> "Change @carol's role to maintainer"

::: code-group

```json [Add member]
{
  "action": "add_to_project",
  "project_id": "my-org/api",
  "user_id": "42",
  "access_level": 30
}
```

```json [Update access]
{
  "action": "update_project",
  "project_id": "my-org/api",
  "user_id": "42",
  "access_level": 40
}
```

:::

## Workload Analysis

> "How many open MRs does each team member have?"

> "Show me issues assigned to @alice that are overdue"

> "List team members who haven't been assigned any issues this sprint"

Combine these queries to balance workload:

1. > "List all open issues in Sprint 14 grouped by assignee"
2. > "Show me MRs created this week per team member"
3. > "Who has the most unresolved review comments?"

## Code Review Delegation

> "Assign @bob as reviewer on MR !42"

> "Add @carol and @dave as reviewers for the API changes"

```json [Set reviewers]
{
  "action": "update",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "reviewer_ids": ["42", "43"]
}
```

## Weekly Reporting

Generate a weekly summary:

1. > "How many MRs were merged this week in `my-org/api`?"
2. > "What issues were closed in the current milestone?"
3. > "Show me pipeline success rate for the last 7 days"
4. > "List any open blockers — issues with label `blocker`"

## Related

- [Sprint Planning](/prompts/project-management/sprint-planning) — Milestone management
- [Code Review](/prompts/code-review/review-mr) — Review workflows
- [Issue Triage](/prompts/project-management/issue-triage) — Organizing issues
