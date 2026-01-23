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

| Action | Description |
|--------|-------------|
| `list` | Search MRs with filters (state, author, reviewer, labels, dates) |
| `get` | Get single MR details by IID or branch name |
| `diffs` | View file changes in an MR |
| `compare` | Compare any two branches or commits |

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

| Action | Description |
|--------|-------------|
| `create` | Create a new MR |
| `update` | Modify title, description, assignees, labels |
| `merge` | Merge an approved MR |
| `approve` | Approve an MR |
| `unapprove` | Remove your approval |
| `get_approval_state` | Check approval status |

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
  "merge_request_iid": "42",
  "source_branch": "feature/auth"
}
```

```json [Merge MR]
{
  "action": "merge",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "source_branch": "feature/auth",
  "squash": true,
  "should_remove_source_branch": true
}
```

:::

## manage_mr_discussion

Add comments, suggestions, and manage discussion threads.

### Actions

| Action | Description |
|--------|-------------|
| `comment` | Add a general comment |
| `thread` | Start a new discussion thread (optionally on a diff line) |
| `reply` | Reply to an existing thread |
| `resolve` | Resolve or unresolve a thread |
| `suggest` | Add a code suggestion |
| `apply_suggestion` | Apply a single suggestion |
| `apply_suggestions` | Batch apply multiple suggestions |
| `update` | Edit a note |

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

| Action | Description |
|--------|-------------|
| `create` | Create a draft note |
| `update` | Modify a draft |
| `publish` | Publish a single draft |
| `publish_all` | Publish all drafts at once |
| `delete` | Remove a draft |

### Workflow

1. Create multiple draft notes as you review
2. Review all your comments for consistency
3. Publish all at once for a clean review experience

## Related Guides

- [Complete Code Review Guide](/guides/complete-code-review)
- [Code Review Prompts](/prompts/code-review/review-mr)
