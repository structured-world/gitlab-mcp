# Setup CI Notifications

Configure pipeline alerts and notifications to stay informed about CI/CD events.

## Overview

This guide shows how to set up notifications for pipeline events using webhooks and integrations. You'll learn to configure Slack, Discord, or custom endpoints to receive real-time CI/CD updates.

**Tools used:** `manage_webhook`, `browse_webhooks`, `manage_integration`, `browse_integrations`

## Option 1: Slack Integration (Recommended)

The built-in Slack integration provides rich notifications with pipeline status, job details, and direct links.

### Step 1: Check Existing Integrations

> "List active integrations in `my-org/api`"

```json
// browse_integrations
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 50
}
```

### Step 2: Configure Slack

> "Set up Slack notifications for pipeline events in `my-org/api`"

```json
// manage_integration
{
  "action": "update",
  "project_id": "my-org/api",
  "integration": "slack",
  "config": {
    "webhook": "https://hooks.slack.com/services/T00/B00/xxx"
  },
  "pipeline_events": true,
  "merge_requests_events": true,
  "push_events": false
}
```

### Step 3: Verify Configuration

> "Check the Slack integration settings"

```json
// browse_integrations
{
  "action": "get",
  "project_id": "my-org/api",
  "integration": "slack"
}
```

## Option 2: Discord Notifications

### Configure Discord Webhook

> "Set up Discord notifications for CI failures"

```json
// manage_integration
{
  "action": "update",
  "project_id": "my-org/api",
  "integration": "discord",
  "config": {
    "webhook": "https://discord.com/api/webhooks/xxx/yyy"
  },
  "pipeline_events": true,
  "merge_requests_events": true
}
```

## Option 3: Microsoft Teams

### Configure Teams Webhook

```json
// manage_integration
{
  "action": "update",
  "project_id": "my-org/api",
  "integration": "microsoft-teams",
  "config": {
    "webhook": "https://outlook.office.com/webhook/xxx"
  },
  "pipeline_events": true
}
```

## Option 4: Custom Webhooks

For custom endpoints or services not covered by built-in integrations.

### Step 1: Create a Pipeline Webhook

> "Create a webhook for pipeline events in `my-org/api`"

```json
// manage_webhook
{
  "action": "create",
  "scope": "project",
  "projectId": "my-org/api",
  "url": "https://my-service.example.com/webhooks/gitlab",
  "pipeline_events": true,
  "job_events": true,
  "push_events": false,
  "merge_requests_events": false,
  "enable_ssl_verification": true,
  "token": "my-secret-token"
}
```

### Step 2: Test the Webhook

> "Test the pipeline webhook to ensure it works"

```json
// manage_webhook
{
  "action": "test",
  "scope": "project",
  "projectId": "my-org/api",
  "hookId": "123",
  "trigger": "pipeline_events"
}
```

### Step 3: Verify Webhook List

> "Show me all configured webhooks"

```json
// browse_webhooks
{
  "action": "list",
  "scope": "project",
  "projectId": "my-org/api",
  "per_page": 20
}
```

## Group-Level Notifications

For notifications across all projects in a group:

### Create Group Webhook

```json
// manage_webhook
{
  "action": "create",
  "scope": "group",
  "groupId": "my-org",
  "url": "https://alerts.example.com/gitlab",
  "pipeline_events": true,
  "merge_requests_events": true,
  "enable_ssl_verification": true
}
```

Group webhooks are inherited by all projects in the group.

## Email Notifications

### Configure Pipeline Emails

```json
// manage_integration
{
  "action": "update",
  "project_id": "my-org/api",
  "integration": "pipelines-email",
  "config": {
    "recipients": "team@example.com ops@example.com"
  },
  "pipeline_events": true
}
```

## Event Types Reference

| Event | Use Case |
|-------|----------|
| `pipeline_events` | Pipeline start, success, failure |
| `job_events` | Individual job status changes |
| `push_events` | Code pushes to branches |
| `merge_requests_events` | MR created, merged, closed |
| `tag_push_events` | New tags/releases |
| `deployment_events` | Deployment status changes |

## Troubleshooting

### Webhook Not Firing

1. Check webhook is enabled (not disabled after failures)
2. Verify the URL is accessible from GitLab
3. Check SSL verification settings
4. Test with the test endpoint

### Integration Not Working

1. Verify the webhook URL is correct
2. Check that the correct events are enabled
3. Try disabling and re-enabling the integration
4. Check GitLab's webhook delivery logs

## Cleanup

### Disable an Integration

```json
// manage_integration
{
  "action": "disable",
  "project_id": "my-org/api",
  "integration": "slack"
}
```

### Delete a Webhook

```json
// manage_webhook
{
  "action": "delete",
  "scope": "project",
  "projectId": "my-org/api",
  "hookId": "123"
}
```
