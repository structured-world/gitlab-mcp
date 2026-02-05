---
title: CI/CD Tools
description: "GitLab MCP CI/CD tools for pipeline automation. Trigger pipelines, retry failed jobs, view logs, manage variables with environment scoping, and control deployments with typed inputs."
head:
  - - meta
    - name: keywords
      content: GitLab CI/CD, pipelines, jobs, variables, MCP, deployment, pipeline management, job logs
---

# GitLab CI/CD Pipeline Tools

Pipeline management, job control, logs, and CI/CD variable configuration.

## Tools Overview

| Tool | Type | Purpose |
|------|------|---------|
| `browse_pipelines` | Query | List pipelines, jobs, view logs |
| `manage_pipeline` | Command | Trigger, retry, cancel pipelines |
| `manage_pipeline_job` | Command | Play, retry, cancel individual jobs |
| `browse_variables` | Query | List and get CI/CD variables |
| `manage_variable` | Command | Create, update, delete variables |

## browse_pipelines

View pipeline status, job details, and console output.

### Actions

<!-- @autogen:tool browse_pipelines -->
| Action | Description |
|--------|-------------|
| `list` | List pipelines with filtering |
| `get` | Get single pipeline details |
| `jobs` | List jobs in a pipeline |
| `triggers` | List bridge/trigger jobs in a pipeline |
| `job` | Get single job details |
| `logs` | Get job console output/logs |
<!-- @autogen:end -->

### Examples

::: code-group

```json [List pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "status": "failed",
  "per_page": 10
}
```

```json [Pipeline jobs]
{
  "action": "jobs",
  "project_id": "my-org/api",
  "pipeline_id": "1234",
  "job_scope": ["failed"],
  "per_page": 50
}
```

```json [Job logs]
{
  "action": "logs",
  "project_id": "my-org/api",
  "job_id": "5678",
  "start": -100,
  "limit": 100
}
```

:::

### Pipeline Filters

| Parameter | Description |
|-----------|-------------|
| `status` | `running`, `pending`, `success`, `failed`, `canceled`, `manual` |
| `ref` | Branch or tag name |
| `source` | `push`, `web`, `schedule`, `merge_request_event`, `api` |
| `username` | Filter by triggering user |
| `order_by` | `id`, `status`, `ref`, `updated_at` |

### Log Navigation

| Parameter | Description |
|-----------|-------------|
| `start` | Line number (positive from start, negative from end) |
| `limit` | Maximum lines to return |

## manage_pipeline

Trigger and control pipeline execution.

### Actions

<!-- @autogen:tool manage_pipeline -->
| Action | Description |
|--------|-------------|
| `create` | Trigger a new pipeline on branch/tag |
| `retry` | Re-run a failed/canceled pipeline |
| `cancel` | Stop a running pipeline |
<!-- @autogen:end -->

### Examples

::: code-group

```json [Trigger pipeline]
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main",
  "variables": [
    { "key": "DEPLOY_ENV", "value": "staging" }
  ]
}
```

```json [Retry failed]
{
  "action": "retry",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

```json [Cancel running]
{
  "action": "cancel",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

```json [With typed inputs]
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main",
  "inputs": {
    "environment": "production",
    "dry_run": true,
    "replicas": 3
  }
}
```

:::

### Pipeline Inputs (GitLab 15.5+)

For pipelines with typed inputs defined in `.gitlab-ci.yml`:

```yaml
# .gitlab-ci.yml
spec:
  inputs:
    environment:
      type: string
      options: [staging, production]
    dry_run:
      type: boolean
      default: false
    replicas:
      type: number
      default: 1
```

Trigger with inputs:

```json
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main",
  "inputs": {
    "environment": "production",
    "dry_run": true,
    "replicas": 3
  }
}
```

::: tip Variables vs Inputs
- **`variables`**: Legacy key-value pairs, no type validation
- **`inputs`**: Typed parameters with schema validation (requires GitLab 15.5+)

You can use both in the same request if needed.
:::

## manage_pipeline_job

Control individual jobs within a pipeline.

### Actions

<!-- @autogen:tool manage_pipeline_job -->
| Action | Description |
|--------|-------------|
| `play` | Trigger a manual job |
| `retry` | Re-run a failed/canceled job |
| `cancel` | Stop a running job |
<!-- @autogen:end -->

### Examples

::: code-group

```json [Play manual job]
{
  "action": "play",
  "project_id": "my-org/api",
  "job_id": "5678",
  "job_variables_attributes": [
    { "key": "TARGET", "value": "production" }
  ]
}
```

```json [Retry job]
{
  "action": "retry",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

```json [Cancel job]
{
  "action": "cancel",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

:::

## browse_variables / manage_variable

Manage CI/CD environment variables with scoping and protection.

### Examples

::: code-group

```json [List variables]
{
  "action": "list",
  "namespace": "my-org/api",
  "per_page": 50
}
```

```json [Create variable]
{
  "action": "create",
  "namespace": "my-org/api",
  "key": "DEPLOY_TOKEN",
  "value": "secure-value",
  "protected": true,
  "masked": true,
  "environment_scope": "production"
}
```

```json [Update variable]
{
  "action": "update",
  "namespace": "my-org/api",
  "key": "DEPLOY_TOKEN",
  "value": "new-value",
  "protected": true,
  "masked": true
}
```

```json [Delete variable]
{
  "action": "delete",
  "namespace": "my-org/api",
  "key": "OLD_VARIABLE"
}
```

:::

### Variable Properties

| Property | Description |
|----------|-------------|
| `protected` | Only available to protected branches/tags |
| `masked` | Hidden in job logs (requires 8+ chars, specific charset) |
| `environment_scope` | `*` for all, or specific like `production` |
| `variable_type` | `env_var` (default) or `file` |

## Related Guides

- [Debug Pipeline Failures](/prompts/ci-cd/debug-failure)
- [Trigger Deployments](/prompts/ci-cd/trigger-deploy)
- [Setup CI Notifications](/guides/setup-ci-notifications)
