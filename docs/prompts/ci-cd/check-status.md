---
title: Check CI Status
description: "Prompts for checking GitLab CI/CD status — pipeline progress, job results, and deployment state"
head:
  - - meta
    - name: keywords
      content: gitlab pipeline status, ci/cd monitoring, job status, pipeline health check, scheduled pipelines, pipeline overview
---

# Check Pipeline Status

Monitor pipeline health and job progress across your projects.

## Pipeline Overview

> "Show me recent pipelines in `my-org/api`"

> "What pipelines are currently running?"

> "List pipelines on the `develop` branch"

::: code-group

```json [Recent pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 10
}
```

```json [Running pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "status": "running",
  "per_page": 10
}
```

```json [By branch]
{
  "action": "list",
  "project_id": "my-org/api",
  "ref": "develop",
  "per_page": 5
}
```

:::

## Pipeline Details

> "Show me details of pipeline #1234"

> "How long did the pipeline take?"

```json [Pipeline info]
{
  "action": "get",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

## Job Status

> "List all jobs in pipeline #1234"

> "Show me the manual jobs waiting for approval"

::: code-group

```json [All jobs]
{
  "action": "jobs",
  "project_id": "my-org/api",
  "pipeline_id": "1234",
  "per_page": 50
}
```

```json [Manual jobs]
{
  "action": "jobs",
  "project_id": "my-org/api",
  "pipeline_id": "1234",
  "job_scope": ["manual"],
  "per_page": 20
}
```

```json [Running jobs]
{
  "action": "jobs",
  "project_id": "my-org/api",
  "pipeline_id": "1234",
  "job_scope": ["running"],
  "per_page": 20
}
```

:::

## Filter by Source

> "Show me pipelines triggered by merge requests"

> "List scheduled pipelines"

::: code-group

```json [MR pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "source": "merge_request_event",
  "per_page": 10
}
```

```json [Scheduled]
{
  "action": "list",
  "project_id": "my-org/api",
  "source": "schedule",
  "per_page": 10
}
```

```json [API-triggered]
{
  "action": "list",
  "project_id": "my-org/api",
  "source": "api",
  "per_page": 10
}
```

:::

## Health Summary Workflow

For a quick health check, combine these prompts:

1. > "List failed pipelines in `my-org/api` from the last 24 hours"
2. > "Show me which jobs failed in those pipelines"
3. > "Are there any currently running pipelines?"

## Next Steps

- [Debug a Failure](/prompts/ci-cd/debug-failure) — Investigate and fix failures
- [Trigger a Deploy](/prompts/ci-cd/trigger-deploy) — Run deployment pipelines
