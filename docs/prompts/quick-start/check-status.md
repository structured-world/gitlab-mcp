# Check Status

Prompts for monitoring merge requests, pipelines, and overall project health.

## Merge Request Status

> "Show me open MRs in `my-org/api` assigned to me"

> "What MRs are waiting for review in `my-org/frontend`?"

> "List MRs merged this week in `my-org/api`"

::: code-group

```json [My open MRs]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "opened",
  "scope": "assigned_to_me",
  "per_page": 20
}
```

```json [Needs review]
{
  "action": "list",
  "project_id": "my-org/frontend",
  "state": "opened",
  "reviewer_username": "my-username",
  "per_page": 20
}
```

```json [Recently merged]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "merged",
  "order_by": "updated_at",
  "sort": "desc",
  "per_page": 10
}
```

:::

## Pipeline Health

> "Show me recent pipeline runs for `my-org/api`"

> "Are there any failed pipelines in `my-org/api`?"

> "What's the status of the latest pipeline on `main`?"

::: code-group

```json [Recent pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 10
}
```

```json [Failed pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "status": "failed",
  "per_page": 10
}
```

```json [Main branch pipeline]
{
  "action": "list",
  "project_id": "my-org/api",
  "ref": "main",
  "per_page": 1
}
```

:::

## Issue Tracking

> "What issues are assigned to me across all projects?"

> "Show open bugs in `my-org/api`"

> "List high-priority issues in milestone 'v2.0'"

::: code-group

```json [Open issues]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": ["OPEN"],
  "types": ["ISSUE"],
  "first": 20,
  "simple": true
}
```

```json [By milestone]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": ["OPEN"],
  "types": ["ISSUE"],
  "first": 20,
  "simple": true
}
```

:::

## Team Activity

> "What has my team been working on today?"

> "Show me recent activity in my projects"

::: code-group

```json [My activity]
{
  "action": "user",
  "per_page": 20
}
```

```json [Project activity]
{
  "action": "project",
  "project_id": "my-org/api",
  "per_page": 20
}
```

:::

## Next Steps

- [Review an MR](/prompts/code-review/review-mr) — Start a code review
- [Debug a Pipeline](/prompts/ci-cd/debug-failure) — Fix CI failures
