---
title: Apply Feedback
description: "Prompts for applying review feedback — resolve discussions, update code, and respond to reviewers"
head:
  - - meta
    - name: keywords
      content: gitlab review feedback, resolve discussions, apply suggestions, merge request update, respond to reviewers, code review workflow
---

# Apply Feedback

Handle review feedback on your merge requests — resolve discussions, apply suggestions, and respond to reviewers.

## View Review Comments

> "Show me all discussions on my MR !42 in `my-org/api`"

> "Are there unresolved threads on MR !42?"

```json [List discussions]
{
  "action": "list",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "per_page": 50
}
```

## Reply to a Thread

> "Reply to the discussion about error handling on MR !42"

> "Thank the reviewer and explain why I chose this approach"

```json [Reply to thread]
{
  "action": "reply",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "discussion_id": "abc123def456",
  "body": "Good point! I've updated the error handling to cover the edge case you mentioned."
}
```

## Resolve Discussions

> "Resolve the discussion thread after addressing the feedback"

> "Mark the error handling thread as resolved"

::: code-group

```json [Resolve thread]
{
  "action": "resolve",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "discussion_id": "abc123def456",
  "resolved": true
}
```

```json [Unresolve thread]
{
  "action": "resolve",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "discussion_id": "abc123def456",
  "resolved": false
}
```

:::

## Apply Suggestions

> "Apply all suggestions on MR !42"

> "Apply suggestion #12345 with a custom commit message"

::: code-group

```json [Single suggestion]
{
  "action": "apply_suggestion",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "suggestion_id": 12345
}
```

```json [Batch apply]
{
  "action": "apply_suggestions",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "suggestion_ids": [12345, 12346],
  "commit_message": "refactor(auth): apply suggested improvements"
}
```

:::

## Update MR After Addressing Feedback

> "Update the MR description to reflect the changes after review"

> "Add a comment summarizing all addressed feedback"

::: code-group

```json [Update description]
{
  "action": "update",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "description": "## Changes\n- Refactored auth module\n- Added error handling (per review feedback)\n- Added tests for edge cases"
}
```

```json [Summary comment]
{
  "action": "comment",
  "project_id": "my-org/api",
  "noteable_type": "merge_request",
  "noteable_id": "42",
  "body": "All review feedback addressed:\n- ✅ Added null checks\n- ✅ Extracted helper function\n- ✅ Added missing tests"
}
```

:::

## Workflow Tips

1. **Address all threads** — Don't leave unresolved discussions before requesting re-review
2. **Reply before resolving** — Explain what you changed so the reviewer can verify
3. **Batch suggestions** — Apply multiple suggestions in one commit to keep history clean
4. **Re-request review** — Update the MR to notify reviewers you're ready

## Next Steps

- [Review an MR](/prompts/code-review/review-mr) — Review someone else's code
- [Debug a Pipeline](/prompts/ci-cd/debug-failure) — Fix CI after pushing changes
