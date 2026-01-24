---
title: DevOps Prompts
description: "GitLab MCP prompts for DevOps engineers — pipeline management, deployments, and infrastructure tasks"
---

# DevOps Prompts

Infrastructure, CI/CD, integrations, and deployment management.

## Pipeline Management

> "Show me all failed pipelines across my projects"

> "What scheduled pipelines are configured?"

> "Trigger a deployment pipeline on `main`"

::: code-group

```json [Failed pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "status": "failed",
  "per_page": 20
}
```

```json [Trigger pipeline]
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main",
  "variables": [
    { "key": "DEPLOY_ENV", "value": "production" }
  ]
}
```

:::

## CI/CD Variables

> "List all CI/CD variables for `my-org/api`"

> "Set the DEPLOY_URL variable for production"

> "Update the Docker registry password"

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
  "key": "DEPLOY_URL",
  "value": "https://api.example.com",
  "environment_scope": "production",
  "protected": true,
  "masked": false
}
```

```json [Update variable]
{
  "action": "update",
  "namespace": "my-org/api",
  "key": "REGISTRY_PASSWORD",
  "value": "new-secure-password",
  "masked": true,
  "protected": true
}
```

:::

## Webhooks

> "List webhooks configured for `my-org/api`"

> "Create a webhook to notify Slack on pipeline failures"

> "Test the deployment webhook"

::: code-group

```json [List webhooks]
{
  "action": "list",
  "scope": "project",
  "projectId": "my-org/api",
  "per_page": 20
}
```

```json [Create webhook]
{
  "action": "create",
  "scope": "project",
  "projectId": "my-org/api",
  "url": "https://hooks.slack.com/services/xxx",
  "pipeline_events": true,
  "push_events": false,
  "enable_ssl_verification": true
}
```

```json [Test webhook]
{
  "action": "test",
  "scope": "project",
  "projectId": "my-org/api",
  "hookId": "123",
  "trigger": "pipeline_events"
}
```

:::

## Integrations

> "What integrations are active in `my-org/api`?"

> "Set up Slack notifications for `my-org/api`"

> "Configure the Jira integration"

::: code-group

```json [List active]
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 50
}
```

```json [Setup Slack]
{
  "action": "update",
  "project_id": "my-org/api",
  "integration": "slack",
  "config": {
    "webhook": "https://hooks.slack.com/services/xxx"
  },
  "push_events": true,
  "pipeline_events": true,
  "merge_requests_events": true
}
```

:::

## Branch Protection

> "Show protected branches in `my-org/api`"

> "Protect the `release/*` branches — only maintainers can push"

::: code-group

```json [List protected]
{
  "action": "list_protected_branches",
  "project_id": "my-org/api"
}
```

```json [Protect branch]
{
  "action": "protect_branch",
  "project_id": "my-org/api",
  "name": "main",
  "push_access_level": 40,
  "merge_access_level": 30,
  "allow_force_push": false
}
```

:::

## Release Management

> "Create a release for tag v2.0.0 with release notes"

> "Add binary assets to the latest release"

See [Release Notes](/prompts/project-management/release-notes) for the complete workflow.

## Monitoring Workflow

Daily DevOps checks:

1. > "Show me failed pipelines in the last 24 hours"
2. > "Are there any stalled manual jobs waiting for approval?"
3. > "List recent deployment events"
4. > "Check if any webhooks have delivery failures"

## Related

- [Debug Pipelines](/prompts/ci-cd/debug-failure) — Pipeline troubleshooting
- [Trigger Deploys](/prompts/ci-cd/trigger-deploy) — Deployment automation
- [Release Notes](/prompts/project-management/release-notes) — Release management
