---
title: GitLab Duo Sessions
description: Discover and inspect asynchronous GitLab Duo sessions, and explicitly start or answer them.
---

# GitLab Duo sessions

`browse_duo_sessions` discovers agents and flows, lists sessions and reads their
progress. `manage_duo_session` starts a CI session or answers a checkpoint.
GitLab owns execution, authorization, history and billing. The MCP server adds
no scheduler or session database.

## Availability

Enable **Duo agents and flows** in account settings. Operators can disable the
domain with `USE_DUO=false`. Read-only mode keeps browsing and removes commands.
Preset restrictions, working scope and `GITLAB_ALLOWED_PROJECT_IDS` apply to the
actual session project, which is resolved before detailed results are fetched.

Use an external GitLab credential with `api` scope for the complete lifecycle;
`read_api` supports browsing. The tools do not assume that the official server's
`mcp` scope or `ai_features` alone permits their external REST and GraphQL calls.

Metadata browsing starts at GitLab 17.3, catalog discovery at 18.5 and configured
consumer execution at 18.7. Catalog input resumption requires 19.4, whose native
permission also checks completion of the preceding CI job. GitLab 19.5 supports
foundational agent CI sessions, URL-targeted flows and all three input checkpoints.
Older schemas expose supported metadata and mark missing details explicitly.

GitLab requires an eligible account and namespace, enabled Duo features, execution
permission, credits and an appropriate online runner. Configured flows can require
a composite identity service account. Discovery reports native eligibility facts;
visibility alone does not establish startability. `null` means unknown.

The presets `developer`, `senior-dev`, `team-lead`, `devops`, `gitlab-com`, `admin`
and `full-access` include Duo. `readonly` includes browsing. Other built-in presets
leave this domain disabled.

## Discover and start

Call `browse_duo_sessions`:

```json
{"action":"agents_and_flows","project_id":"example-group/backend","first":20}
```

Keep opaque cursors exactly as returned. Disabled entries are filtered after
pagination: an empty `items` page can still have `hasNextPage=true`. Foundational
agents appear on the first page. Descriptions are bounded previews.

Choose exactly one discovered selector: an enabled foundational `flow` reference,
a project `consumer_id`, or a foundational `agent` reference. A consumer ID is
distinct from `catalog_item_id`; raw catalog items are not execution selectors.
Default interactive Duo Chat entries cannot start these CI sessions.

Call `manage_duo_session` only when the user requested execution:

```json
{"action":"start","project_id":"example-group/backend","consumer_id":"91","goal":"Investigate and repair failing tests"}
```

This schedules real CI work, can change GitLab and can consume credits. The
response returns a workflow ID immediately. `fix_pipeline/v1` requires a pipeline
URL and `code_review/v1` requires a merge-request URL, both on the selected instance
and project. GitLab resolves their branch and context; no default branch is substituted.

## Progress and results

Call `browse_duo_sessions` with `get` and the returned `workflow_id`. `list` finds
the caller's sessions, optionally filtered by `project_id`, with opaque pagination.

Results include status, available links, summary, latest agent answer, created
merge requests, work items and notes, and pending input. Summaries are limited
to 1000 characters, answers to 4000, notes to 160, and each created-object
connection to 20 entries. Truncation is explicit. Each API response is bounded
to 4 MiB; oversized or unreadable history is reported instead of treated as empty.

`created` suggests a later check after 120 seconds; running sessions suggest 30.
Waiting, paused and terminal sessions have no polling suggestion. Use bounded
follow-up reads, not a model polling loop. Unknown future status codes remain
visible. `finished`, `failed` and `stopped` are terminal. Failed status and missing
checkpoints do not prove that no changes occurred; inspect outputs and GitLab links.

## Answer, approve or reject

For `input_required`, `plan_approval_required` or `tool_call_approval_required`,
inspect `pending_input.can_send`. A checkpoint can be visible before its CI job
finishes. GitLab's resume permission is checked again before sending input;
GitLab remains authoritative for concurrent state changes.

```json
{"action":"send_input","workflow_id":"73","human_approval":false,"human_message":"Keep the implementation focused"}
```

To approve, send `human_approval:true` and omit the message. To reject or answer,
send `false` with optional feedback of at most 2000 Unicode characters. Commands
can schedule another CI job and consume credits. The REST resume API is experimental.

After a timeout, disconnect or ambiguous result, inspect `get` or `list` before
deciding whether another command is necessary. HTTP and gateway-disconnected
writes are never automatically replayed.

For `401`, reconnect the selected account. For `403`, inspect native permissions,
credits, runner and service-account prerequisites; do not enable features or
escalate privileges automatically. `404` can mean an unavailable resource or API,
not proof that no previous changes occurred. Honor a returned `Retry-After` on
`429`; a write still must not be automatically replayed.

MCP project restrictions govern these session tools. Actions inside a session
remain governed by GitLab's native permissions and execution environment.
See the official [Flows API](https://docs.gitlab.com/api/duo_agent_platform_flows/)
and [session controls](https://docs.gitlab.com/user/duo_agent_platform/sessions/).
