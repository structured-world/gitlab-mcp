---
title: Codex and Claude Workflow Skills
description: Portable GitLab workflows, independent client schemas, structured diagnostics and compatibility boundaries.
---

# Codex and Claude workflow skills

The npm package includes five portable skills under `skills/`. They use the existing
MCP tools and work with a configured Codex or Claude Code connection:

| Skill               | Workflow                                                             |
| ------------------- | -------------------------------------------------------------------- |
| `gitlab-setup`      | Diagnose connection, selected account, scope and missing permissions |
| `gitlab-discovery`  | Resolve an exact project or namespace for follow-up work             |
| `gitlab-review`     | Inspect MR changes/discussions and publish requested feedback        |
| `gitlab-work-items` | Find and manage requested issues and other work items                |
| `gitlab-ci`         | Investigate failed jobs with bounded log reads                       |

Plugin packaging can include this directory directly. For a project-scoped skill
installation, place the packaged skill directories in the host's supported project
skill directory (`.agents/skills/` for Codex, `.claude/skills/` for Claude Code).
Keep each directory and its `SKILL.md` together. The skills contain no checkout-specific
paths, credentials, or user-wide instruction requirements.

Invoke a skill by its installed name, for example `$gitlab-ci` in Codex, or ask
"Investigate the failed GitLab pipeline linked here." Skill descriptions identify
when they apply; unrelated requests should not select GitLab workflows. Tool prefixes
depend on the configured connection name, so skills resolve the installed catalog.

This shared workflow foundation does not itself install a desktop plugin, provide
a native settings panel, or introduce a new OAuth account-linking flow. Use the
existing host connection/authentication entry points. Never paste access tokens
into the conversation. Claude Channels remain an optional Claude capability.

## Client contracts

- Tool discovery retains `title`, `icons`, `annotations`, `outputSchema`, execution
  declarations and `_meta`, including declared UI/auth metadata. Internal handlers
  and gate configuration are not exposed.
- Hints describe the whole CQRS tool. Mixed commands remain conservative even if
  one action reads. `manage_context` mutates session settings and therefore has
  `readOnlyHint: false`, despite being available in GitLab read-only mode.
- The default schema mode remains `flat`. With `GITLAB_SCHEMA_MODE=auto`, each MCP
  session selects its format from its own initialized client identity. Inspector
  receives discriminated unions; Claude, Codex and unknown clients receive flat
  schemas. Initialization order does not alter another client's schema.
- Instance version/tier caches are shared by instance URL. OAuth grants are applied
  per request to discovery, execution and diagnostic counts; they are not cached
  as another account's permissions. Older stored sessions without reported grants
  retain unknown permissions, and GitLab remains the authority for execution.
- GitLab version/tier gates, read-only policy, namespace restrictions and denied
  actions remain enforced independently of descriptive hints.

## Structured diagnostics and failures

`manage_context` advertises an object-root output schema. Success is:

```json
{
  "action": "list_presets",
  "data": []
}
```

All eight context actions have declared data shapes. Arrays live inside `data`.
The previous domain JSON remains in text content, preserving Claude's readable
results. Large entity results, diffs and job logs keep their existing text contract
and are not duplicated as full structured payloads.

Failures set `isError: true`, retain the previous JSON text, and expose
`structuredContent.error`. The diagnostic schema declares both success and error
envelopes because SDK clients also validate present structured content on failures.
Native tool envelopes preserve content blocks, authentication/UI metadata and
`isError`; invalid declared success outputs are rejected before delivery.

A timeout after a mutation may mean it completed upstream. Reconcile the current
entity before another attempt. Neither the skills nor the Claude gateway blindly
replay writes. The gateway retries a sent read only after an actual connection loss,
and never interprets an error result as a successful operation to watch.

## Verify the installed workflows

Build the monorepo and run `yarn evaluate:skills codex` or
`yarn evaluate:skills claude` from the core package. The evaluator resolves the
selected client from the operator's PATH before entering its isolated workspace;
arbitrary executable arguments are rejected. Windows npm CLI shims are supported.
The evaluation packs the npm artifact,
loads its skills into a temporary workspace/session-only plugin, and runs the
actual built server against a deterministic loopback GitLab fixture. It does not
use live GitLab credentials or modify global client configuration.

The matrix covers all five direct workflows, indirect discovery/review, a retained
conversation follow-up, an unrelated request and a denied mutation. Assertions
inspect actual tool calls, prohibit unintended writes/replays, and retain client
versions, transcripts and fixture requests in the printed temporary directory.
They also verify skill loading and returned project/work-item/diff/log data. The
Codex invocation explicitly permits only the fixture's `manage_context` and
`manage_work_item` commands, so the denied-write scenario reaches the server rather
than stopping at a host approval prompt. This is local evaluation configuration;
it does not change a user's installed connection permissions.
These evaluations require authenticated real clients and model access. They do
not prove availability of a desktop UI surface or one-click marketplace installation.

Protocol regression tests additionally connect two SDK clients simultaneously in
both initialization orders with different protocol revisions, schema formats,
GitLab versions and account grants. Live integration uses the repository's existing
`test` namespace and configured test environment.
