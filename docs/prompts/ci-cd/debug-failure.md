---
title: Debug CI Failures
description: "Prompts for debugging GitLab CI/CD failures — analyze logs, identify root causes, and fix pipelines"
head:
  - - meta
    - name: keywords
      content: gitlab ci debug, pipeline failure, job logs, test failure, build error, retry pipeline, ci/cd troubleshooting
---

# Debug Pipeline Failures

Quickly diagnose and fix CI/CD failures using GitLab MCP.

## Find Failed Pipelines

> "Show me failed pipelines in `my-org/api`"

> "What's the status of the latest pipeline on `main`?"

::: code-group

```json [Failed pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "status": "failed",
  "per_page": 5
}
```

```json [Latest on branch]
{
  "action": "list",
  "project_id": "my-org/api",
  "ref": "main",
  "per_page": 1
}
```

:::

## Identify Failed Jobs

> "Which jobs failed in pipeline #1234?"

> "Show me all jobs in the failed pipeline"

::: code-group

```json [Failed jobs only]
{
  "action": "jobs",
  "project_id": "my-org/api",
  "pipeline_id": "1234",
  "job_scope": ["failed"],
  "per_page": 20
}
```

```json [All jobs]
{
  "action": "jobs",
  "project_id": "my-org/api",
  "pipeline_id": "1234",
  "per_page": 50
}
```

:::

## Read Error Logs

> "Show me the logs for job #5678"

> "What's the error in the test job?"

::: code-group

```json [Full logs]
{
  "action": "logs",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

```json [Last 100 lines]
{
  "action": "logs",
  "project_id": "my-org/api",
  "job_id": "5678",
  "start": -100,
  "limit": 100
}
```

:::

## Common Failure Patterns

### Test Failures

> "Show me the test job logs — I need to see which tests failed"

Look for patterns like:
- `FAIL src/__tests__/auth.test.ts` — Specific test file failure
- `Expected: X, Received: Y` — Assertion mismatch
- `Timeout` — Test exceeded time limit

### Build Errors

> "The build job failed — show me the compilation errors"

Look for:
- `error TS2345` — TypeScript type errors
- `Module not found` — Missing dependencies
- `SyntaxError` — Code syntax issues

### Dependency Issues

> "The install job failed — is there a package issue?"

Look for:
- `ERESOLVE` — Version conflicts
- `404 Not Found` — Package registry issues
- `EACCES` — Permission problems

## Retry or Cancel

> "Retry the failed jobs in pipeline #1234"

> "Cancel the running pipeline on my feature branch"

::: code-group

```jsonc [Retry pipeline]
// manage_pipeline
{
  "action": "retry",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

```jsonc [Cancel pipeline]
// manage_pipeline
{
  "action": "cancel",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

```jsonc [Retry single job]
// manage_pipeline_job
{
  "action": "retry",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

:::

## Next Steps

- [Check Pipeline Status](/prompts/ci-cd/check-status) — Monitor ongoing pipelines
- [Trigger a Deploy](/prompts/ci-cd/trigger-deploy) — Deploy after fixing
