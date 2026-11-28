---
title: Code Review Tools
description: "GitLab MCP code review tools for merge request workflows. Browse MRs, view diffs, manage discussions, post draft notes, add code suggestions, and handle approvals with AI assistance."
head:
  - - meta
    - name: keywords
      content: GitLab code review, merge requests, MR discussions, draft notes, code suggestions, MCP
---

# GitLab Code Review and MR Tools

Tools for the complete merge request review workflow — browsing MRs, viewing diffs, adding comments, and managing approvals.

## Tools Overview

| Tool | Type | Purpose |
|------|------|---------|
| `browse_merge_requests` | Query | List, get details, view diffs, compare branches |
| `browse_mr_discussions` | Query | View discussion threads and draft notes |
| `manage_merge_request` | Command | Create, update, merge, approve MRs |
| `manage_mr_discussion` | Command | Comments, threads, replies, suggestions, batch review |
| `manage_draft_notes` | Command | Batch review with draft comments |

## browse_merge_requests

Find and inspect merge requests.

### Actions

<!-- @autogen:tool browse_merge_requests -->
| Action | Description |
|--------|-------------|
| `list` | List merge requests with filtering |
| `get` | Get single MR by IID or branch name |
| `closing_issues` | Read one page of visible issues GitLab would close on merge; does not close issues |
| `diffs` | Get file changes/diffs for an MR |
| `conflicts` | Read why an MR cannot merge: GitLab's conflict status and, for each conflicting file, its paths and the regions between conflict markers; reads only, never resolves |
| `compare` | Compare two branches or commits |
| `versions` | List all diff versions of an MR (each push creates a version) |
| `version` | Get specific MR diff version with file changes |
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

```json [Find added lines]
{
  "action": "diffs",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "line_patterns": ["console\\.log", "(?i)todo"],
  "exclude_lockfiles": true
}
```

```json [Read conflicts]
{
  "action": "conflicts",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "context_lines": 3
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

```json [List MR versions]
{
  "action": "versions",
  "project_id": "my-org/api",
  "merge_request_iid": "42"
}
```

```json [Get specific version]
{
  "action": "version",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "version_id": "123"
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

### Diff Line Search

`diffs` and `compare`, like `browse_commits` `diff`, take `line_patterns` to return
only the changed lines that match, instead of every hunk of every file. In `diffs`
the path filters (`exclude_patterns`, `exclude_lockfiles`, `exclude_generated`)
apply first.

| Parameter | Description |
|-----------|-------------|
| `line_patterns` | RE2 patterns (up to 8, inline flags such as `(?i)`); a line matches when any pattern does |
| `side` | `added` (default), `removed` or `any`; unchanged lines are context only |
| `context` | Diff lines before and after each match, within its hunk (0 to 5, default 1) |
| `max_matches` | Matches returned (default 200, max 1000); `match_count` counts all |

The file list (`changes` for `diffs`, `diffs` for `compare`) then holds only files
with matches, each with `old_path`, `new_path`, its `new_file`, `renamed_file` and
`deleted_file` flags, and `matches`. A match has its `side`, `text` (without the
`+`/`-` prefix), the indexes of the `patterns` it matched, `context.before` and
`context.after`, and the line numbers a positioned comment takes: an added line has
only `new_line`, a removed line only `old_line`, a context line both. Pass them to
`manage_mr_discussion` with the MR's `diff_refs` to comment on the match.

`_filtered` reports `files_scanned`, `files_matched`, `match_count` and `truncated`
(more matches than `max_matches`). Files whose lines could not be searched are listed
in `not_scanned` with a `reason`:

| `reason` | Meaning |
|----------|---------|
| `collapsed` | GitLab left the diff out of the response; it can be read on its own |
| `too_large` | The diff exceeds GitLab's size limit and cannot be retrieved |
| `empty_diff` | GitLab sent no diff text and, before 18.4, does not say why: collapsed, too large, or a change without text lines such as a rename |
| `binary` | Binary file |

GitLab's own `overflow` (`diffs`) and `compare_timeout` (`compare`) stay in the
result: when true, GitLab stopped listing files, so later files were not searched.

### Merge Conflicts

`conflicts` (GitLab 19.4+) reads why a merge request cannot merge, as GitLab computes
it: a normal diff does not show conflicts, and nothing here is resolved, rebased or
written. `status` says what GitLab reports, with a `reason`:

| `status` | Meaning |
|----------|---------|
| `has_conflicts` | Conflicts; `files` lists the conflicting files |
| `no_conflicts` | The merge request can be merged without conflicts |
| `unchecked` | GitLab has not checked mergeability yet; the read asks it to (it does so for users who can update the merge request), so read again shortly |
| `branch_missing` | The source or target branch is missing, or the diff is incomplete |
| `no_push_access` | GitLab returns conflict files only to users who can push to the source branch |
| `files_unavailable` | Conflicts, but GitLab could not return the files (binary, or a side of the conflict is missing) |
| `source_outside_scope` | The source branch is in a fork outside the allowed projects; its contents are not returned |

Each file has `our_path` (source branch), `their_path` (target branch),
`conflict_count` and `hunks`: the regions from GitLab's `<<<<<<< our_path` marker to
its `>>>>>>> their_path` marker with `context_lines` around them (default 3, max 20),
each with the `start_line` of its first line in the file. A file without markers, such
as a deletion on one side, is shown from its first line; a file GitLab sent without
text has `content_unavailable`. All regions of one call share a 64 KiB budget and lines
are cut at 2000 characters (`long_lines_cut`): every conflicting file is still listed,
and regions left out are counted in `hunks_omitted`, with `truncated` set on the
result. `file_path` returns one file by its source or target path, while `files_total`
counts them all.

## manage_merge_request

Create and manage merge requests.

For the `merge` action, set `merge_when_pipeline_succeeds: true` to request
auto-merge without waiting for the pipeline locally. Both ordinary merge and
auto-merge send an expected source-branch head SHA to GitLab. An explicit `sha`
is sent unchanged. When omitted, ordinary merge reuses the head from its
mergeability check; auto-merge reads the current head first. Auto-merge with an
explicit SHA does not need that read. If the head changes before GitLab accepts
the request, its conflict error is returned; the tool does not retry with a newer
head. A missing head stops the write. This also works when the namespace requires
a commit SHA for merges.

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
| `review` | Post several diff comments and an optional summary note on one MR, anchored to the reviewed head |
<!-- @autogen:end -->

### Batch Review

`review` posts up to 20 diff comments and an optional `summary` note on one merge
request in a single call. `head_sha` is the head the comments were written against
(`diff_refs.head_sha` from `browse_merge_requests` `get`). Each comment names a `path`
and `new_line`, `old_line` or both: an added line takes `new_line`, a removed line
`old_line`, and an unchanged line either one (the other is filled in) or both. For a
renamed or deleted file `path` may be the old path. `suggestion` adds a suggestion
block for the commented line, which must exist in the new version.

Before anything is written, the merge request's latest diff version must still be at
`head_sha`, and every comment must name a line of that diff; otherwise the call is
refused with every problem listed and nothing is published. The check reads the diff
version GitLab shows: a push that GitLab has not turned into a new version yet, or one
made while the review is written, is not caught, and the comments stay on the version
that was reviewed. Text GitLab would run as a quick action (a line starting with `/`
outside code, also after GitLab drops carriage returns) is refused too: an approval
is `manage_merge_request` `approve`, not text in a comment.

From GitLab 16.3, whose draft notes take a diff position, the comments and the summary
are first created as your drafts, visible to nobody else. If one cannot be created,
the drafts already made are deleted and nothing is published. They are then published
together, and `published_as` says how:

| `published_as` | Meaning |
|----------------|---------|
| `review` | Submitted as one review with a single notification; you had no other pending drafts |
| `separate` | Published one by one, because submitting a review would also publish your other pending drafts, which stay pending |
| `threads` | Before GitLab 16.3: each comment posted directly as a diff thread, then the summary |

Publishing is not a transaction. After a failure the tool reads which drafts are still
pending, and each comment and the summary report a `status`:

| `status` | Meaning |
|----------|---------|
| `published` | Visible on the merge request (`threads` also gives `discussion_id` and `note_id`) |
| `draft` | Still your unpublished draft: publish or delete it by `draft_note_id` with `manage_draft_notes` |
| `failed` | GitLab refused it; nothing was created (`threads`) |
| `unknown` | The request ended without a clear answer; check the discussions and drafts before resending it |
| `not_attempted` | An earlier write did not succeed (`threads`) |

`complete` is true when every comment and the summary were published.

### Examples

::: code-group

```json [Batch review]
{
  "action": "review",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "head_sha": "4f8a2d0c1e9b7a6f5d4c3b2a1908f7e6d5c4b3a2",
  "comments": [
    { "path": "src/auth.ts", "new_line": 15, "body": "Handle the expired token here" },
    {
      "path": "src/auth.ts",
      "new_line": 22,
      "body": "Use optional chaining",
      "suggestion": "const name = user?.name ?? 'Unknown';"
    },
    { "path": "src/session.ts", "old_line": 8, "body": "This check is still needed" }
  ],
  "summary": "Two blocking issues, one nit."
}
```

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
