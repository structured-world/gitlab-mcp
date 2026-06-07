---
title: GitLab Product Manager Prompts
description: "Product manager prompts for GitLab MCP. Track epics and work items, manage milestones, monitor releases, organize with labels, and generate sprint and velocity reports with AI assistance."
head:
  - - meta
    - name: keywords
      content: gitlab product manager, roadmap planning, epics, milestone tracking, release coordination, team velocity, sprint report
---

# GitLab Product Manager Prompts

Work items, roadmap planning, milestone tracking, and release coordination.

## Project Overview

> "Show me all projects in the `my-org` group"

> "What's the current state of `my-org/api`?"

::: code-group

```json [Group projects]
{
  "action": "list",
  "group_id": "my-org",
  "per_page": 50
}
```

```json [Project details]
{
  "action": "get",
  "project_id": "my-org/api"
}
```

:::

## Work Items & Epics

> "Show me all open epics in `my-org`"

> "List issues in the 'Authentication' epic"

> "Create a new epic for the Q2 roadmap"

::: code-group

```json [Group epics]
{
  "action": "list",
  "namespace": "my-org",
  "state": ["OPEN"],
  "types": ["EPIC"],
  "first": 20,
  "simple": true
}
```

```json [Create epic]
{
  "action": "create",
  "namespace": "my-org",
  "workItemType": "EPIC",
  "title": "Q2 2025: Platform Modernization",
  "description": "## Objective\nModernize the platform infrastructure\n\n## Key Results\n- Migrate to microservices\n- Achieve 99.9% uptime\n- Reduce deploy time to <5min"
}
```

:::

## Milestone Roadmap

> "Show me all milestones in `my-org` with their progress"

> "What's the burndown for milestone 'v2.0'?"

> "Create a milestone for the Q2 release"

::: code-group

```json [Active milestones]
{
  "action": "list",
  "namespace": "my-org",
  "state": "active",
  "per_page": 20
}
```

```json [Milestone progress]
{
  "action": "get",
  "namespace": "my-org/api",
  "milestone_id": "42"
}
```

```json [Create milestone]
{
  "action": "create",
  "namespace": "my-org",
  "title": "Q2 2025 Release",
  "description": "Platform modernization milestone",
  "start_date": "2025-04-01",
  "due_date": "2025-06-30"
}
```

:::

## Issue Tracking

> "How many open issues are there by priority?"

> "Show me issues blocking the release"

> "What's the breakdown of bug vs feature issues?"

::: code-group

```json [Open issues]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": ["OPEN"],
  "types": ["ISSUE"],
  "first": 50,
  "simple": true
}
```

```json [Incidents]
{
  "action": "list",
  "namespace": "my-org/api",
  "state": ["OPEN"],
  "types": ["INCIDENT"],
  "first": 20,
  "simple": true
}
```

:::

## Release Tracking

> "Show me the latest releases across my projects"

> "What's included in the upcoming v2.0 release?"

> "Generate release notes from merged MRs"

::: code-group

```json [Latest releases]
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 5
}
```

```json [Release details]
{
  "action": "get",
  "project_id": "my-org/api",
  "tag_name": "v1.5.0"
}
```

:::

## Labels for Organization

> "Create labels for our workflow: `status::planning`, `status::in-progress`, `status::review`"

> "List all labels in the group"

::: code-group

```json [Create workflow labels]
{
  "action": "create",
  "namespace": "my-org",
  "name": "status::planning",
  "color": "#428BCA",
  "description": "In planning phase"
}
```

```json [Group labels]
{
  "action": "list",
  "namespace": "my-org",
  "per_page": 50
}
```

:::

## Reporting Workflows

### Sprint Report
1. > "Show burndown data for the current milestone"
2. > "How many issues were completed vs added this sprint?"
3. > "List MRs merged in this milestone"

### Release Readiness
1. > "Are there open blockers for milestone 'v2.0'?"
2. > "What's the pipeline status on the release branch?"
3. > "Show unresolved discussions on open MRs targeting release"

### Team Velocity
1. > "How many issues were closed each week for the last month?"
2. > "What's the average time-to-merge for MRs?"
3. > "Show me completed vs planned work per sprint"

## Related

- [Sprint Planning](/prompts/project-management/sprint-planning) — Milestone management
- [Release Notes](/prompts/project-management/release-notes) — Release creation
- [Issue Triage](/prompts/project-management/issue-triage) — Issue organization
