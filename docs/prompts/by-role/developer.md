---
title: Developer Prompts
description: "GitLab MCP prompts for developers — code review, branch management, and CI/CD debugging workflows"
head:
  - - meta
    - name: keywords
      content: gitlab developer workflow, branch management, create merge request, code search, edit files, ci/cd debugging
---

# Developer Prompts

Focused prompts for daily development workflows — code, MRs, pipelines, and debugging.

## Morning Standup

> "Show me my open MRs and their pipeline status"

> "What review requests are waiting for me?"

> "List my todos — what needs attention?"

## Working with Branches

> "Create a branch `feature/user-auth` from `main` in `my-org/api`"

> "Show me all branches matching `feature/*` in `my-org/api`"

> "Compare `feature/user-auth` with `main` — what's the diff?"

::: code-group

```json [Create branch]
{
  "project_id": "my-org/api",
  "branch": "feature/user-auth",
  "ref": "main"
}
```

```json [List feature branches]
{
  "action": "list_branches",
  "project_id": "my-org/api",
  "search": "feature/"
}
```

```json [Compare branches]
{
  "action": "compare",
  "project_id": "my-org/api",
  "from": "main",
  "to": "feature/user-auth",
  "per_page": 20
}
```

:::

## Creating Merge Requests

> "Create an MR from `feature/user-auth` to `main` in `my-org/api`"

> "Create a draft MR for my work-in-progress"

::: code-group

```json [Standard MR]
{
  "action": "create",
  "project_id": "my-org/api",
  "source_branch": "feature/user-auth",
  "target_branch": "main",
  "title": "feat: Add user authentication module",
  "description": "## Changes\n- JWT token generation\n- Session middleware\n- Login/logout endpoints\n\n## Testing\n- Added unit tests for auth service\n- Integration tests for endpoints",
  "remove_source_branch": true
}
```

```json [Draft MR]
{
  "action": "create",
  "project_id": "my-org/api",
  "source_branch": "feature/user-auth",
  "target_branch": "main",
  "title": "Draft: User authentication (WIP)",
  "description": "Work in progress - not ready for review yet"
}
```

:::

## Editing Files

> "Update the version in `package.json` to 2.0.0"

> "Create a new config file `src/config/auth.ts`"

::: code-group

```json [Update file]
{
  "action": "single",
  "project_id": "my-org/api",
  "file_path": "src/config/auth.ts",
  "content": "export const AUTH_CONFIG = {\n  tokenExpiry: '24h',\n  refreshExpiry: '7d',\n};",
  "commit_message": "feat: add auth configuration",
  "branch": "feature/user-auth"
}
```

```json [Multiple files]
{
  "action": "batch",
  "project_id": "my-org/api",
  "branch": "feature/user-auth",
  "commit_message": "feat: add auth module files",
  "files": [
    {
      "file_path": "src/auth/index.ts",
      "content": "export { AuthService } from './service';"
    },
    {
      "file_path": "src/auth/service.ts",
      "content": "export class AuthService {\n  // implementation\n}"
    }
  ]
}
```

:::

## Debugging CI

> "My pipeline failed — show me the error logs"

> "Retry the failed test job"

> "What's the status of my MR's pipeline?"

See [Debug Pipeline Failures](/prompts/ci-cd/debug-failure) for the complete workflow.

## Code Search

> "Search for `AuthService` across all projects"

> "Find files containing `TODO` in `my-org/api`"

::: code-group

```json [Code search]
{
  "action": "project",
  "project_id": "my-org/api",
  "scope": "blobs",
  "search": "AuthService",
  "per_page": 20
}
```

```json [Global search]
{
  "action": "global",
  "scope": "blobs",
  "search": "AuthService",
  "per_page": 20
}
```

:::

## Daily Workflow

1. Check todos and review requests
2. Review pending MRs assigned to you
3. Push code and create/update MRs
4. Monitor pipeline status
5. Address review feedback
6. Merge approved MRs

## Related

- [Code Review](/prompts/code-review/review-mr) — Review workflows
- [Debug Pipelines](/prompts/ci-cd/debug-failure) — CI troubleshooting
- [Explore Repo](/prompts/quick-start/explore-repo) — Navigate codebases
