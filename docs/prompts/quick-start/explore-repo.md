---
title: Explore a Repo
description: "Prompts for exploring GitLab repositories — browse files, view commits, and understand project structure"
---

# Explore a Repository

Prompts to understand a project's structure, recent changes, and current state.

## Browse the Codebase

> "Show me the directory structure of `my-org/api`"

> "What's in the `src/services/` directory?"

> "Read the file `src/config.ts` in `my-org/api`"

::: code-group

```json [Root directory]
{
  "action": "tree",
  "project_id": "my-org/api",
  "path": "",
  "per_page": 50
}
```

```json [Subdirectory]
{
  "action": "tree",
  "project_id": "my-org/api",
  "path": "src/services",
  "per_page": 50
}
```

```json [File content]
{
  "action": "content",
  "project_id": "my-org/api",
  "file_path": "src/config.ts"
}
```

:::

## View Recent Changes

> "Show me the last 10 commits in `my-org/api`"

> "What changed in the `main` branch this week?"

> "Who committed to `my-org/api` today?"

::: code-group

```json [Recent commits]
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 10
}
```

```json [Commits this week]
{
  "action": "list",
  "project_id": "my-org/api",
  "since": "2025-01-20T00:00:00Z",
  "per_page": 20
}
```

```json [Commits by author]
{
  "action": "list",
  "project_id": "my-org/api",
  "author": "alice@example.com",
  "per_page": 10
}
```

:::

## Inspect a Specific Commit

> "Show me the details of commit `abc1234` in `my-org/api`"

> "What files changed in the last commit?"

::: code-group

```json [Commit details]
{
  "action": "get",
  "project_id": "my-org/api",
  "sha": "abc1234",
  "stats": true
}
```

```json [Commit diff]
{
  "action": "diff",
  "project_id": "my-org/api",
  "sha": "abc1234",
  "per_page": 20
}
```

:::

## Check Project Activity

> "What happened in `my-org/api` recently?"

> "Show me push events from the last week"

::: code-group

```json [Project events]
{
  "action": "project",
  "project_id": "my-org/api",
  "per_page": 20
}
```

```json [Push events only]
{
  "action": "project",
  "project_id": "my-org/api",
  "event_action": "pushed",
  "per_page": 20
}
```

:::

## Next Steps

- [Check Status](/prompts/quick-start/check-status) — Monitor MRs and pipelines
- [Code Review Prompts](/prompts/code-review/review-mr) — Start reviewing code
