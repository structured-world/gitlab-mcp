# Review a Merge Request

Complete workflow for performing a thorough code review using GitLab MCP.

## Step 1: Find MRs to Review

> "Show me MRs waiting for my review in `my-org/api`"

> "List open MRs with label `needs-review` in `my-org/frontend`"

::: code-group

```json [Awaiting my review]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "opened",
  "reviewer_username": "my-username",
  "per_page": 20
}
```

```json [By label]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "opened",
  "labels": "needs-review",
  "per_page": 20
}
```

:::

## Step 2: Get MR Details

> "Show me the details of MR !42 in `my-org/api`"

> "What's the description and discussion status of MR !42?"

::: code-group

```json [MR details]
{
  "action": "get",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "per_page": 20
}
```

```json [MR by branch]
{
  "action": "get",
  "project_id": "my-org/api",
  "branch_name": "feature/login-refactor",
  "per_page": 20
}
```

:::

## Step 3: View the Diff

> "Show me the file changes in MR !42"

> "What files were modified in this MR?"

::: code-group

```json [Full diff]
{
  "action": "diffs",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "per_page": 50
}
```

```json [Compare branches]
{
  "action": "compare",
  "project_id": "my-org/api",
  "from": "main",
  "to": "feature/login-refactor",
  "per_page": 20
}
```

:::

## Step 4: Read Existing Discussions

> "Show me the discussion threads on MR !42"

> "Are there unresolved discussions?"

```json [List discussions]
{
  "action": "list",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "per_page": 50
}
```

## Step 5: Leave Feedback

> "Add a comment on MR !42 saying the implementation looks good"

> "Start a discussion thread on MR !42 about the error handling"

::: code-group

```json [General comment]
{
  "action": "comment",
  "project_id": "my-org/api",
  "noteable_type": "merge_request",
  "noteable_id": "42",
  "body": "LGTM! Clean implementation with good test coverage."
}
```

```json [Start a thread]
{
  "action": "thread",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "body": "Consider adding error handling for the null case here."
}
```

:::

## Step 6: Approve or Request Changes

> "Approve MR !42 in `my-org/api`"

> "Check the approval status of MR !42"

::: code-group

```json [Approve]
{
  "action": "approve",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "source_branch": "feature/login-refactor"
}
```

```json [Check approval state]
{
  "action": "get_approval_state",
  "project_id": "my-org/api",
  "merge_request_iid": "42",
  "source_branch": "feature/login-refactor"
}
```

:::

## Tips for Effective Reviews

1. **Read the description first** — Understand the intent before looking at code
2. **Check the diff size** — Large diffs may need multiple review passes
3. **Look at test coverage** — Verify tests exist for new functionality
4. **Check pipeline status** — Ensure CI passes before approving
5. **Use suggestions** — Provide concrete fixes, not just complaints

## Next Steps

- [Suggest Changes](/prompts/code-review/suggest-changes) — Add code suggestions
- [Apply Feedback](/prompts/code-review/apply-feedback) — Apply suggestions from reviews
