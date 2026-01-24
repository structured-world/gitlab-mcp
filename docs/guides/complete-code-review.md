---
title: Complete Code Review
description: "End-to-end guide for AI-powered code reviews with GitLab MCP — from MR creation to merge approval"
---

# Complete Code Review Guide

End-to-end workflow for performing thorough code reviews using GitLab MCP.

## Overview

This guide walks through a complete code review process — from finding MRs to review, through analyzing changes, to providing actionable feedback and approving.

**Tools used:** `browse_merge_requests`, `browse_mr_discussions`, `manage_mr_discussion`, `manage_draft_notes`, `manage_merge_request`

## Step 1: Find MRs Awaiting Review

Start by identifying merge requests that need your attention.

> "Show me MRs where I'm assigned as reviewer in `my-org/api`"

```jsonc
// browse_merge_requests
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "opened",
  "reviewer_username": "your-username",
  "per_page": 20
}
```

You can also check your todo list for review requests:

```jsonc
// browse_todos
{
  "action": "list",
  "per_page": 20,
  "state": "pending",
  "todo_action": "review_requested"
}
```

## Step 2: Understand the MR Context

Before looking at code, understand what the MR is about.

> "Get the details of MR !42 — title, description, and labels"

```jsonc
// browse_merge_requests
{
  "action": "get",
  "project_id": "my-org/api",
  "merge_request_iid": "42"
}
```

**Check for:**
- Clear description explaining the *why*
- Related issue references
- Test plan or testing notes
- Breaking change warnings

## Step 3: Review the Diff

Look at the actual code changes.

> "Show me the file changes in MR !42"

```jsonc
// browse_merge_requests
{
  "action": "diffs",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "per_page": 100
}
```

**What to look for:**
- Logic correctness
- Edge cases and error handling
- Security concerns (input validation, auth checks)
- Performance implications
- Test coverage for new code
- Code style consistency

## Step 4: Check Pipeline Status

Ensure tests pass before spending time reviewing.

> "What's the pipeline status for MR !42?"

```jsonc
// browse_pipelines
{
  "action": "list",
  "project_id": "my-org/api",
  "ref": "feature/user-auth",
  "per_page": 1
}
```

If the pipeline is failing, you may want to wait or note the failures in your review.

## Step 5: Review Existing Discussions

Check if other reviewers have already provided feedback.

> "Show me discussion threads on MR !42"

```jsonc
// browse_mr_discussions
{
  "action": "list",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "per_page": 50
}
```

## Step 6: Prepare Your Review (Draft Notes)

Use draft notes to write all your comments before publishing — this gives a better experience for the author.

> "Create a draft comment about the error handling"

```jsonc
// manage_draft_notes
{
  "action": "create",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "note": "The error handling here doesn't account for network timeouts. Consider adding a catch for `ETIMEDOUT` errors."
}
```

For inline comments on specific lines:

```jsonc
// manage_draft_notes
{
  "action": "create",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "note": "This could throw if `user` is null",
  "position": {
    "base_sha": "abc123",
    "head_sha": "def456",
    "start_sha": "ghi789",
    "new_path": "src/auth.ts",
    "new_line": 42,
    "position_type": "text"
  }
}
```

## Step 7: Add Code Suggestions

For concrete fixes, use suggestions that can be applied directly.

> "Suggest using optional chaining on line 42"

```jsonc
// manage_mr_discussion
{
  "action": "suggest",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "comment": "Use optional chaining to handle the null case",
  "suggestion": "const name = user?.profile?.name ?? 'Anonymous';",
  "position": {
    "base_sha": "abc123",
    "head_sha": "def456",
    "start_sha": "ghi789",
    "new_path": "src/auth.ts",
    "new_line": 42,
    "position_type": "text"
  }
}
```

## Step 8: Publish Your Review

When all your comments are ready, publish them at once.

> "Publish all my draft notes on MR !42"

```jsonc
// manage_draft_notes
{
  "action": "publish_all",
  "project_id": "my-org/api",
  "merge_request_iid": "42"
}
```

## Step 9: Approve or Request Changes

Based on your review, either approve or leave it for the author to address.

::: code-group

```jsonc [Approve]
// manage_merge_request
{
  "action": "approve",
  "project_id": "my-org/api",
  "merge_request_iid": "42"
}
```

```jsonc [Request changes (comment)]
// manage_mr_discussion
{
  "action": "comment",
  "project_id": "my-org/api",
  "noteable_type": "merge_request",
  "noteable_id": "42",
  "body": "Good progress! Please address the error handling comments before we merge. Key issues:\n- Missing null checks in auth module\n- No timeout handling for API calls\n- Test coverage for edge cases"
}
```

:::

## Step 10: Follow Up

After the author addresses feedback, verify the changes.

> "Show me recent commits on MR !42 — did they address the feedback?"

```jsonc
// browse_commits
{
  "action": "list",
  "project_id": "my-org/api",
  "ref_name": "feature/user-auth",
  "per_page": 5
}
```

Then resolve your discussion threads:

```jsonc
// manage_mr_discussion
{
  "action": "resolve",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "discussion_id": "thread-id-here",
  "resolved": true
}
```

## Review Checklist

- [ ] Description is clear and complete
- [ ] Tests exist for new functionality
- [ ] No security vulnerabilities introduced
- [ ] Error handling is appropriate
- [ ] No hardcoded secrets or credentials
- [ ] Performance impact is acceptable
- [ ] Breaking changes are documented
- [ ] CI pipeline passes

## Tips for Better Reviews

1. **Be specific** — Point to exact lines and explain the issue
2. **Offer solutions** — Use suggestions for concrete fixes
3. **Prioritize** — Distinguish blockers from nice-to-haves
4. **Be kind** — The author is human; frame feedback constructively
5. **Batch feedback** — Use draft notes to publish all at once
