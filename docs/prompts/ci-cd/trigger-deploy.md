# Trigger Deployments

Run pipelines, trigger manual jobs, and manage deployments with GitLab MCP.

## Run a New Pipeline

> "Trigger a pipeline on `main` in `my-org/api`"

> "Run a pipeline on `release/v2.0` with deploy variables"

::: code-group

```json [Simple trigger]
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main"
}
```

```json [With variables]
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main",
  "variables": [
    { "key": "DEPLOY_ENV", "value": "staging" },
    { "key": "SKIP_TESTS", "value": "false" }
  ]
}
```

:::

## Trigger Manual Deploy Jobs

> "Play the deploy-to-staging job in pipeline #1234"

> "Run the manual production deploy job"

::: code-group

```json [Play job]
{
  "action": "play",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

```json [Play with variables]
{
  "action": "play",
  "project_id": "my-org/api",
  "job_id": "5678",
  "job_variables_attributes": [
    { "key": "DEPLOY_TARGET", "value": "production" }
  ]
}
```

:::

## Monitor Deploy Progress

> "Check the status of the deploy job #5678"

> "Show me the deploy job logs"

::: code-group

```json [Job status]
{
  "action": "job",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

```json [Job logs]
{
  "action": "logs",
  "project_id": "my-org/api",
  "job_id": "5678",
  "start": -50,
  "limit": 50
}
```

:::

## Cancel a Deploy

> "Cancel the running deploy job — something went wrong"

> "Stop pipeline #1234 immediately"

::: code-group

```json [Cancel job]
{
  "action": "cancel",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

```json [Cancel pipeline]
{
  "action": "cancel",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

:::

## Deployment Workflow

A typical deployment sequence:

1. > "Run a pipeline on `main` in `my-org/api`"
2. > "Check if all test and build jobs passed in the new pipeline"
3. > "Play the deploy-to-staging job"
4. > "Show me the staging deploy logs"
5. > "Play the deploy-to-production job"

## Manage CI/CD Variables

> "List CI/CD variables for `my-org/api`"

> "What's the value of the DEPLOY_URL variable?"

::: code-group

```json [List variables]
{
  "action": "list",
  "namespace": "my-org/api",
  "per_page": 50
}
```

```json [Get variable]
{
  "action": "get",
  "namespace": "my-org/api",
  "key": "DEPLOY_URL"
}
```

:::

## Next Steps

- [Check Status](/prompts/ci-cd/check-status) — Verify deployment succeeded
- [Debug Failure](/prompts/ci-cd/debug-failure) — If deployment fails
