---
title: Suggest Changes
description: "Prompts for suggesting code changes in GitLab MRs — inline comments and improvement recommendations"
---

# Suggest Changes

Use code suggestions to provide concrete fixes during code review. Suggestions can be applied directly from the MR interface.

## Add a Code Suggestion

> "Suggest replacing the null check with optional chaining on line 15 of `src/auth.ts` in MR !42"

> "Add a suggestion to rename the variable on line 23"

```json [Create suggestion]
{
  "action": "suggest",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "comment": "Consider using optional chaining for cleaner null handling",
  "suggestion": "const name = user?.profile?.name ?? 'Unknown';",
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

## Multi-Line Suggestions

> "Replace lines 10-15 with a more efficient implementation"

Use `lines_above` and `lines_below` to include surrounding context:

```json [Multi-line suggestion]
{
  "action": "suggest",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "comment": "This can be simplified using Array.filter",
  "suggestion": "const active = users.filter(u => u.isActive);\nconst names = active.map(u => u.name);",
  "lines_above": 2,
  "lines_below": 1,
  "position": {
    "base_sha": "abc123",
    "head_sha": "def456",
    "start_sha": "ghi789",
    "new_path": "src/users.ts",
    "new_line": 12,
    "position_type": "text"
  }
}
```

## Apply a Suggestion

> "Apply the suggestion #12345 on MR !42"

::: code-group

```json [Apply single]
{
  "action": "apply_suggestion",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "suggestion_id": 12345,
  "commit_message": "refactor(auth): use optional chaining for null safety"
}
```

```json [Apply multiple]
{
  "action": "apply_suggestions",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "suggestion_ids": [12345, 12346, 12347],
  "commit_message": "refactor(review): apply code suggestions"
}
```

:::

## Draft Notes for Batch Reviews

Use draft notes to prepare all your feedback before publishing:

> "Create a draft note on MR !42 — I'll publish all comments at once"

::: code-group

```json [Create draft]
{
  "action": "create",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "note": "Consider extracting this into a helper function"
}
```

```json [Publish all drafts]
{
  "action": "publish_all",
  "project_id": "my-org/api",
  "merge_request_iid": "42"
}
```

:::

## Tips

1. **Provide context** — Explain *why* the change is better, not just *what* to change
2. **Use batch suggestions** — Apply multiple suggestions in a single commit
3. **Draft first** — Use draft notes to review all feedback before publishing
4. **Be constructive** — Offer solutions, not just criticism

## Next Steps

- [Apply Feedback](/prompts/code-review/apply-feedback) — Handle suggestions on your own MRs
- [Review an MR](/prompts/code-review/review-mr) — Full review workflow
