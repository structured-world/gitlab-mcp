---
title: Repository Tools
description: "GitLab repository tools — browse files, commits, refs, compare branches, and manage repository content"
head:
  - - meta
    - name: keywords
      content: GitLab repository, files, commits, branches, tags, releases, branch protection, MCP
---

# GitLab Repository Management Tools

File browsing, commits, branches, tags, and repository management.

## Tools Overview

| Tool | Type | Purpose |
|------|------|---------|
| `browse_files` | Query | Directory tree and file content |
| `manage_files` | Command | Create, update, upload files |
| `browse_commits` | Query | Commit history, details, diffs |
| `browse_refs` | Query | Branches, tags, protection rules |
| `manage_ref` | Command | Create/delete/protect branches and tags |
| `browse_releases` | Query | Release history and assets |
| `manage_release` | Command | Create releases with assets |

## Files

### browse_files

<!-- @autogen:tool browse_files -->
| Action | Description |
|--------|-------------|
| `tree` | List files and folders in a directory |
| `content` | Read file contents |
| `download_attachment` | Download a file attachment from issues/MRs |
<!-- @autogen:end -->

::: code-group

```json [Directory listing]
{
  "action": "tree",
  "project_id": "my-org/api",
  "path": "src/services",
  "recursive": false,
  "per_page": 50
}
```

```json [Read file]
{
  "action": "content",
  "project_id": "my-org/api",
  "file_path": "src/config.ts",
  "ref": "main"
}
```

```json [Recursive tree]
{
  "action": "tree",
  "project_id": "my-org/api",
  "path": "",
  "recursive": true,
  "per_page": 100
}
```

:::

### manage_files

<!-- @autogen:tool manage_files -->
| Action | Description |
|--------|-------------|
| `single` | Create or update a single file |
| `batch` | Commit multiple files atomically |
| `upload` | Upload a file as markdown attachment |
<!-- @autogen:end -->

::: code-group

```json [Create/update file]
{
  "action": "single",
  "project_id": "my-org/api",
  "file_path": "src/new-feature.ts",
  "content": "export function newFeature() {\n  return true;\n}",
  "commit_message": "feat: add new feature module",
  "branch": "feature/new"
}
```

```json [Batch commit]
{
  "action": "batch",
  "project_id": "my-org/api",
  "branch": "feature/new",
  "commit_message": "feat: add service module",
  "files": [
    {
      "file_path": "src/service/index.ts",
      "content": "export { Service } from './service';"
    },
    {
      "file_path": "src/service/service.ts",
      "content": "export class Service {}"
    }
  ]
}
```

:::

## Commits

### browse_commits

<!-- @autogen:tool browse_commits -->
| Action | Description |
|--------|-------------|
| `list` | Browse commit history |
| `get` | Retrieve commit details |
| `diff` | Get code changes in a commit |
<!-- @autogen:end -->

::: code-group

```json [Recent commits]
{
  "action": "list",
  "project_id": "my-org/api",
  "ref_name": "main",
  "per_page": 10
}
```

```json [By author]
{
  "action": "list",
  "project_id": "my-org/api",
  "author": "alice@example.com",
  "since": "2025-01-01T00:00:00Z",
  "per_page": 20
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

### Commit Filters

| Parameter | Description |
|-----------|-------------|
| `ref_name` | Branch or tag to list commits from |
| `author` | Filter by author name or email |
| `since` / `until` | Date range (ISO 8601) |
| `path` | Only commits affecting this file/directory |
| `all` | Include commits from all branches |

## Branches & Tags

### browse_refs

<!-- @autogen:tool browse_refs -->
| Action | Description |
|--------|-------------|
| `list_branches` | List all repository branches with optional search |
| `get_branch` | Get details of a specific branch |
| `list_tags` | List all repository tags |
| `get_tag` | Get details of a specific tag |
| `list_protected_branches` | List all protected branches with their protection rules |
| `get_protected_branch` | Get protection rules for a specific branch |
| `list_protected_tags` | List all protected tags with their protection rules |
<!-- @autogen:end -->

::: code-group

```json [List branches]
{
  "action": "list_branches",
  "project_id": "my-org/api",
  "search": "feature/"
}
```

```json [List tags]
{
  "action": "list_tags",
  "project_id": "my-org/api",
  "order_by": "version",
  "sort": "desc"
}
```

```json [Protected branches]
{
  "action": "list_protected_branches",
  "project_id": "my-org/api"
}
```

:::

### manage_ref

<!-- @autogen:tool manage_ref -->
| Action | Description |
|--------|-------------|
| `create_branch` | Create a new branch from an existing ref |
| `delete_branch` | Delete a branch from the repository |
| `protect_branch` | Add protection rules to a branch or pattern |
| `unprotect_branch` | Remove protection from a branch |
| `update_branch_protection` | Update protection rules for a branch |
| `create_tag` | Create a new tag in the repository |
| `delete_tag` | Delete a tag from the repository |
| `protect_tag` | Add protection rules to a tag pattern (Premium) |
| `unprotect_tag` | Remove protection from a tag pattern (Premium) |
<!-- @autogen:end -->

::: code-group

```json [Create branch]
{
  "action": "create_branch",
  "project_id": "my-org/api",
  "branch": "feature/new",
  "ref": "main"
}
```

```json [Delete branch]
{
  "action": "delete_branch",
  "project_id": "my-org/api",
  "branch": "feature/old"
}
```

```json [Protect branch]
{
  "action": "protect_branch",
  "project_id": "my-org/api",
  "name": "main",
  "push_access_level": 40,
  "merge_access_level": 30
}
```

```json [Create tag]
{
  "action": "create_tag",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "ref": "main",
  "message": "Release version 2.0.0"
}
```

:::

## Releases

### browse_releases

::: code-group

```json [List releases]
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 10
}
```

```json [Get release]
{
  "action": "get",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0"
}
```

:::

### manage_release

::: code-group

```json [Create release]
{
  "action": "create",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "v2.0.0",
  "description": "## Changes\n- Feature A\n- Bug fix B",
  "milestones": ["v2.0"]
}
```

```json [Add asset]
{
  "action": "create_link",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "Linux Binary",
  "url": "https://example.com/bin/v2.0.0/app",
  "link_type": "package"
}
```

:::

## Related

- [Developer Prompts](/prompts/by-role/developer)
- [Explore Repo Prompts](/prompts/quick-start/explore-repo)
- [Release Notes Prompts](/prompts/project-management/release-notes)
- [Automate Releases Guide](/guides/automate-releases)
