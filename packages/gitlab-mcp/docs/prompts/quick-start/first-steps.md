---
title: First Steps with GitLab MCP
description: "Getting started prompts for GitLab MCP Server. Learn to discover projects, check todos, explore repositories, and find team members with ready-to-use example prompts and API parameters."
head:
  - - meta
    - name: keywords
      content: gitlab mcp getting started, explore projects, list repositories, gitlab todos, project discovery, first steps
---

# First Steps with GitLab MCP

Your first interactions with GitLab MCP. These prompts help you explore what's available and understand the basics.

## Discover Your Projects

> "List all projects I have access to"

> "Show me the projects in the `my-org` group"

> "Find projects with the topic `python`"

::: code-group

```json [List your projects]
{
  "action": "list",
  "membership": true,
  "per_page": 20
}
```

```json [Search by name]
{
  "action": "search",
  "q": "backend-api",
  "per_page": 20
}
```

```json [Browse a group]
{
  "action": "list",
  "group_id": "my-org",
  "per_page": 20
}
```

:::

## Check Your Todos

> "What tasks need my attention?"

> "Show me my pending review requests"

> "Mark all my todos as done"

::: code-group

```json [Pending todos]
{
  "per_page": 20,
  "state": "pending"
}
```

```json [Review requests]
{
  "per_page": 20,
  "action": "review_requested"
}
```

:::

## Explore a Project

> "Show me the file structure of `my-org/backend-api`"

> "Read the README of `my-org/frontend`"

> "What branches exist in `my-org/api`?"

::: code-group

```json [File tree]
{
  "action": "tree",
  "project_id": "my-org/backend-api",
  "per_page": 100
}
```

```json [Read a file]
{
  "action": "content",
  "project_id": "my-org/backend-api",
  "file_path": "README.md"
}
```

```json [List branches]
{
  "action": "list_branches",
  "project_id": "my-org/backend-api"
}
```

:::

## Find People

> "Who are the members of `my-org/backend-api`?"

> "Find the user with username `alice`"

::: code-group

```json [Project members]
{
  "project_id": "my-org/backend-api",
  "per_page": 50
}
```

```json [Search users]
{
  "search": "alice",
  "per_page": 20
}
```

:::

## Next Steps

- [Explore a Repository](/prompts/quick-start/explore-repo) — Dive deeper into project contents
- [Check Status](/prompts/quick-start/check-status) — Monitor MRs and pipelines
