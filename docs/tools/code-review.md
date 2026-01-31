---
title: Code Review Tools
description: "GitLab code review tools — browse merge requests, manage discussions, and post review comments"
head:
  - - meta
    - name: keywords
      content: GitLab code review, merge requests, MR discussions, draft notes, code suggestions, MCP
---

# Code Review Tools

Tools for the complete merge request review workflow — browsing MRs, viewing diffs, adding comments, and managing approvals.

## Tools Overview

| Tool | Type | Purpose |
|------|------|---------|
| `browse_merge_requests` | Query | List, get details, view diffs, compare branches |
| `browse_mr_discussions` | Query | View discussion threads and draft notes |
| `manage_merge_request` | Command | Create, update, merge, approve MRs |
| `manage_mr_discussion` | Command | Comments, threads, replies, suggestions |
| `manage_draft_notes` | Command | Batch review with draft comments |

## browse_merge_requests

Find and inspect merge requests.

### Actions

<!-- @autogen:tool browse_merge_requests -->
| Action | Description |
|--------|-------------|
| `list` | List merge requests with filtering |
| `get` | Get single MR by IID or branch name |
| `diffs` | Get file changes/diffs for an MR |
| `compare` | Compare two branches or commits |
<!-- @autogen:end -->

### Examples

::: code-group

```json [List open MRs]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "opened",
  "per_page": 20
}
```

```json [Get MR by IID]
{
  "action": "get",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "per_page": 20
}
```

```json [View diff]
{
  "action": "diffs",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "per_page": 100
}
```

```json [Compare branches]
{
  "action": "compare",
  "project_id": "my-org/api",
  "from": "main",
  "to": "feature/auth",
  "per_page": 20
}
```

:::

### Key Filters for `list`

| Parameter | Description |
|-----------|-------------|
| `state` | `opened`, `closed`, `merged`, `all` |
| `author_username` | Filter by MR author |
| `reviewer_username` | Filter by assigned reviewer |
| `assignee_username` | Filter by assignee |
| `labels` | Filter by labels (comma-separated or array) |
| `milestone` | Filter by milestone title |
| `source_branch` | Filter by source branch |
| `target_branch` | Filter by target branch |
| `wip` | `yes` for drafts, `no` for ready |
| `order_by` | `created_at`, `updated_at`, `priority` |
| `scope` | `created_by_me`, `assigned_to_me`, `all` |

## manage_merge_request

Create and manage merge requests.

### Actions

<!-- @autogen:tool manage_merge_request -->
| Action | Description |
|--------|-------------|
| `create` | Create a new merge request |
| `update` | Update an existing merge request |
| `merge` | Merge an approved merge request |
| `approve` | Approve a merge request |
| `unapprove` | Remove your approval from a merge request |
| `get_approval_state` | Get current approval status and rules |
<!-- @autogen:end -->

### Examples

::: code-group

```json [Create MR]
{
  "action": "create",
  "project_id": "my-org/api",
  "source_branch": "feature/auth",
  "target_branch": "main",
  "title": "feat: Add authentication",
  "description": "Implements JWT auth flow",
  "remove_source_branch": true,
  "reviewer_ids": ["42"]
}
```

```json [Approve MR]
{
  "action": "approve",
  "project_id": "my-org/api",
  "merge_request_iid": "42"
}
```

```json [Merge MR]
{
  "action": "merge",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "squash": true,
  "should_remove_source_branch": true
}
```

:::

## manage_mr_discussion

Add comments, suggestions, and manage discussion threads.

### Actions

<!-- @autogen:tool manage_mr_discussion -->
| Action | Description |
|--------|-------------|
| `comment` | Add a comment to an issue or merge request |
| `thread` | Start a new discussion thread on an MR |
| `reply` | Reply to an existing discussion thread |
| `update` | Update an existing note/comment |
| `apply_suggestion` | Apply a single code suggestion from a review |
| `apply_suggestions` | Batch apply multiple code suggestions |
| `resolve` | Resolve or unresolve a discussion thread |
| `suggest` | Create a code suggestion on a diff line |
<!-- @autogen:end -->

### Examples

::: code-group

```json [Add comment]
{
  "action": "comment",
  "project_id": "my-org/api",
  "noteable_type": "merge_request",
  "noteable_id": "42",
  "body": "LGTM! Great work on the tests."
}
```

```json [Code suggestion]
{
  "action": "suggest",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "comment": "Use optional chaining here",
  "suggestion": "const name = user?.name ?? 'Unknown';",
  "position": {
    "base_sha": "abc123",
    "head_sha": "def456",
    "start_sha": "ghi789",
    "new_path": "src/auth.ts",
    "new_line": 15,
    "position_type": "text"
  }
}
```

```json [Resolve thread]
{
  "action": "resolve",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "discussion_id": "abc123",
  "resolved": true
}
```

:::

## manage_draft_notes

Prepare all review comments before publishing them at once.

### Actions

<!-- @autogen:tool manage_draft_notes -->
| Action | Description |
|--------|-------------|
| `create` | Create a new draft note |
| `update` | Update an existing draft note |
| `publish` | Publish a single draft note |
| `publish_all` | Publish all draft notes at once |
| `delete` | Delete a draft note |
<!-- @autogen:end -->

### Workflow

1. Create multiple draft notes as you review
2. Review all your comments for consistency
3. Publish all at once for a clean review experience

## Related Guides

- [Complete Code Review Guide](/guides/complete-code-review)
- [Code Review Prompts](/prompts/code-review/review-mr)
