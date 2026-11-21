---
title: CI/CD Tools
description: 'GitLab MCP CI/CD tools for pipeline automation. Trigger pipelines, read bounded job logs and individual artifact files, manage variables with environment scoping, and control deployments with typed inputs.'
head:
  - - meta
    - name: keywords
      content: GitLab CI/CD, pipelines, jobs, variables, MCP, deployment, pipeline management, job logs, artifact files
---

# GitLab CI/CD Pipeline Tools

Pipeline management, job control, logs, individual artifact files, and CI/CD variable configuration.

## Tools Overview

| Tool                  | Type    | Purpose                                                             |
| --------------------- | ------- | ------------------------------------------------------------------- |
| `browse_pipelines`    | Query   | List pipelines and jobs, read logs and artifact files               |
| `manage_pipeline`     | Command | Trigger/retry/cancel pipelines; play/retry/cancel individual jobs   |
| `browse_variables`    | Query   | List and get CI/CD variables                                        |
| `manage_variable`     | Command | Create, update, delete variables                                    |
| `browse_environments` | Query   | List environments and deployments                                   |
| `manage_environment`  | Command | Create, update, stop, delete environments; update deployment status |

## browse_pipelines

View pipeline status, job details, console output, and individual artifact files.

### Actions

<!-- @autogen:tool browse_pipelines -->

| Action          | Description                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`          | List pipelines with filtering                                                                                                                     |
| `get`           | Get single pipeline details                                                                                                                       |
| `jobs`          | List jobs in a pipeline                                                                                                                           |
| `triggers`      | List bridge/trigger jobs in a pipeline                                                                                                            |
| `job`           | Get single job details                                                                                                                            |
| `log_sections`  | List the sections of a job log (runner steps such as step_script, and custom sections) with line ranges and durations                             |
| `logs`          | Read job logs with bounded memory and explicit byte truncation                                                                                    |
| `log_grep`      | Search a whole job log, or the logs of a pipeline's failed jobs, with RE2 patterns; returns matching lines with context and absolute line numbers |
| `artifact_file` | Read one artifact file as bounded UTF-8 text; inspect job metadata to choose its path                                                             |

<!-- @autogen:end -->

### Examples

::: code-group

```json [List pipelines]
{
  "action": "list",
  "project_id": "my-org/api",
  "status": "failed",
  "per_page": 10
}
```

```json [Pipeline jobs]
{
  "action": "jobs",
  "project_id": "my-org/api",
  "pipeline_id": "1234",
  "job_scope": ["failed"],
  "per_page": 50
}
```

```json [Job logs]
{
  "action": "logs",
  "project_id": "my-org/api",
  "job_id": "5678",
  "start": -100,
  "per_page": 100
}
```

```json [Log sections]
{
  "action": "log_sections",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

```json [Search the script output]
{
  "action": "log_grep",
  "project_id": "my-org/api",
  "job_id": "5678",
  "preset": "failures",
  "section": "step_script"
}
```

```json [Find failures in a log]
{
  "action": "log_grep",
  "project_id": "my-org/api",
  "job_id": "5678",
  "preset": "failures"
}
```

```json [Why a pipeline failed]
{
  "action": "log_grep",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

:::

### Pipeline Filters

| Parameter  | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `status`   | `running`, `pending`, `success`, `failed`, `canceled`, `manual` |
| `ref`      | Branch or tag name                                              |
| `source`   | `push`, `web`, `schedule`, `merge_request_event`, `api`         |
| `username` | Filter by triggering user                                       |
| `order_by` | `id`, `status`, `ref`, `updated_at`                             |

### Log Sections

`log_sections` lists the sections of a job log before you read it: the runner's own
steps (`prepare_executor`, `get_sources`, `step_script`, `upload_artifacts_on_failure`,
...) and the custom collapsible sections a job writes with `section_start` and
`section_end` markers. Each entry has:

| Field              | Meaning                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| `name`             | The name in the marker, as written                                              |
| `occurrence`       | Earlier sections with the same name, counted from 0; pass it as `section_index` |
| `depth`            | Sections open when this one started                                             |
| `start_line`       | Line of the start marker, numbered as in `logs`                                 |
| `end_line`         | Line of the end marker, or the last line for a section still open at the end    |
| `line_count`       | Lines from `start_line` to `end_line`                                           |
| `duration_seconds` | Time between the two markers; null without an end marker                        |
| `collapsed`        | Whether the marker asks the GitLab view to show the section collapsed           |
| `terminated`       | Whether an end marker closed the section                                        |

```json
{
  "action": "log_sections",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

Sections follow the GitLab log view: they are open by name rather than nested on a
stack, a second start of an open name restarts that section, and an end marker whose
name is not open is ignored. Names are compared as GitLab compares them, ignoring
case and treating every character other than a letter or digit alike. At most 500
sections are listed; `sections_truncated` is true when the log has more.
`complete` is false, and `total_lines` null, when the processing budget stopped the
scan; sections still open then have no `end_line`. Markers count wherever they stand
on a line, also past the 16 KiB of a line that `logs` returns. A marker the scan cannot
read (one longer than 16 KiB, or more than 256 in the long tails of one line) sets
`sections_unread_from_line`; ranges from that line on may be wrong, and a `section`
whose bounds it affects returns an error instead of a guess.

Pass `section` to `logs` or `log_grep` to work inside one section, by its exact name;
`section_index` picks a repeated one. An unknown name, or an index past the last
occurrence, returns an error naming the sections the log has. The section is found
on the rendered log, so a marker inside a color sequence or split by the runner across
timestamped fragments counts as it does in the GitLab view; with `raw: true`, markers
are found in each stored line on its own. When a timestamped line continues across a
section boundary, only its fragments inside the section are searched, and a match is
reported on the first of them.

### Log Navigation

| Parameter       | Description                                                     |
| --------------- | --------------------------------------------------------------- |
| `start`         | Line number (positive from start, negative from end)            |
| `per_page`      | Maximum source lines to return, default 200, maximum 10000      |
| `section`       | Read only this section; `start` and `nextStart` count within it |
| `section_index` | Which section of that name, counting from 0                     |

With `section`, `start`, `per_page` and `nextStart` count lines from the section's
first line, a negative `start` counts from its last line, and `totalLines` is the
section's line count. `startLine` stays the absolute line number of the first line
shown, and `section` reports the section's absolute range. The trace is read only up
to the section's end, and the page only up to its own last line.

Without `start`, logs return the last `per_page` lines. A negative `start` selects
from the end, limited to the last `per_page` lines of that selection. A nonnegative
integer selects a page from the beginning. The response retains `totalLines`,
`shownLines`, `startLine`, `hasMore` and `nextStart`; pass `nextStart` as the next
request's `start`. Notice lines do not count toward these fields.

The reader streams the trace through EOF to count all source lines, retaining at
most **1 MiB of source bytes** for the page and the first **16 KiB per source line**.
Transport buffers, decoding, line metadata and response serialization need additional
bounded memory. This limits retained memory, not total network traffic or scan time.
Empty input counts as one line; a final newline introduces an empty last line.

If the byte budget clips content, the response adds a **LOG CONTENT TRUNCATED**
notice and `truncation` metadata. Its `reason` is `byte_limits`, `maxLineBytes` is
16384, `maxPageBytes` is 1048576, and `lines` identifies each affected zero-based
source line with `omittedPrefixBytes` and `omittedSuffixBytes`. UTF-8 fragments
never introduce replacement characters solely because a limit splits a character.

For a forward page the byte budget preserves the earliest content; for a tail page
it preserves the most recent retained content. Some selected lines may therefore
have no remaining text. Line counts and cursors still describe the source lines,
including clipped lines. Request fewer lines to reduce page clipping; **line
pagination cannot recover bytes omitted from an oversized individual line**.
Inspect the full trace in GitLab when those bytes are needed. A failed or cancelled
read returns an error rather than a successful partial page.

### Log Search

`log_grep` scans the whole trace on the server and returns only matching lines,
with context, instead of pages of the log. Use it before paging `logs` when you
need to find something in a long job.

| Parameter       | Description                                                                        |
| --------------- | ---------------------------------------------------------------------------------- |
| `patterns`      | Up to 8 RE2 patterns, 512 characters each; a line matches when any pattern does    |
| `preset`        | `failures`: common compiler, test, interpreter and runner failure output           |
| `before`        | Context lines before each match, default 2, maximum 20                             |
| `after`         | Context lines after each match, default 2, maximum 20                              |
| `max_matches`   | Matches to return, default 50, maximum 500; `match_count` still counts all of them |
| `invert`        | Select lines matching no pattern                                                   |
| `start_line`    | First line to search; pass `resume_from` from a truncated result                   |
| `raw`           | Match the stored bytes instead of the rendered text                                |
| `section`       | Search only this section; see [Log Sections](#log-sections)                        |
| `section_index` | Which section of that name, counting from 0                                        |

At least one of `patterns` and `preset` is required. Patterns use
[RE2 syntax](https://github.com/google/re2/wiki/Syntax), which runs in linear time;
lookarounds and backreferences are not available. Flags are written inline, for
example `(?i)timeout`. Invalid patterns are rejected before GitLab is contacted.

By default each line is matched as the GitLab job log view renders it: runner
timestamps, ANSI color sequences, `section_start`/`section_end` markers and text
overwritten by a carriage return are removed. Returned lines are rendered the same
way. Timestamps, when the runner adds them, are reported per line in `timestamps`.
The runner splits a long output line into fragments whose timestamp marks them as
continuations; like the GitLab view, the search joins them before rendering, so a
pattern can match across fragments, an escape sequence split between fragments is
removed whole, and a carriage return clears the fragments before it, which are then
returned empty. A fragment cut at the per-line limit no longer adjoins the next one:
the text on each side of the cut is searched on its own, so neither a match nor an
escape sequence reaches across it. A line of more than 32 fragments is joined 32 at a time; every
fragment is searched, but a match, an escape sequence or a carriage return does not
reach across two such groups. The match is reported at the first fragment of its
group, and every fragment of that group is returned, except when the output limit
falls inside it on the first hunk of a call: the result then ends at the last
fragment that fit, and the continuation starts after it, so read the rest of that
line with `logs`. `raw: true` matches and returns each stored line as is, including
a leading byte order mark.

```json
{
  "action": "log_grep",
  "project_id": "my-org/api",
  "job_id": "5678",
  "patterns": ["(?i)timed? ?out", "error TS[0-9]+"],
  "before": 3,
  "after": 1
}
```

The result lists `hunks` like `grep -C`: overlapping and adjacent context windows
are merged. Each hunk has `start_line`, its `lines`, and `matches` with the absolute
zero-based `line` and the indexes of the `patterns` it matched; with a preset, the
preset's index is `preset_index`, after the caller's patterns. Line numbers are the
same as in `logs`, so `logs` with `start` set to a match reads more around it. Lines
clipped by the 16 KiB per-line limit are listed in `clipped`; only their first 16 KiB
is searched.

With `section`, matches and their context lines all come from that section, with
absolute line numbers, and the result reports the section's range in `section`. The
search ends with the section, so `total_lines` is null; `match_count` is still
complete. A `start_line` inside the section continues a truncated search there.

`match_count` counts every match found, including those beyond `max_matches`.
`total_lines` is the number of lines in the trace, or null when the scan stopped
early. When `truncated` is set, pass `resume_from` as `start_line` to continue:
the next call reports each remaining match exactly once.

| `truncated`      | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `max_matches`    | More matches exist after the last one returned                               |
| `budget`         | The search spent its processing time (2 s) before the end of the trace       |
| `output_limit`   | The returned lines reached 1 MiB of text, the same bound as a page of `logs` |
| `worker_timeout` | One line took too long to match; returned hunks are complete                 |

When the budget runs out inside a hunk, the search first finishes that hunk's
after-context. At the output limit, a hunk that does not fit is left for the next
call, unless it is the first one, which is cut at the limit; when its before-context
leaves no room for its match, it starts at the match instead.

Searches run on a small pool of worker threads, so a long trace never blocks other
requests. When every worker is busy, the call fails at once with a retryable error.
The trace is streamed with bounded memory, as with `logs`, and the returned text is
bounded too.

### Pipeline Log Search

With `pipeline_id` instead of `job_id`, `log_grep` answers "why did this pipeline
fail" in one call: it lists the pipeline's jobs and searches their logs. Without
`patterns`, the `failures` preset is used. The two IDs are mutually exclusive.

| Parameter                  | Description                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `job_scope`                | Statuses of the jobs to search, default `["failed"]`                                         |
| `include_downstream`       | Follow trigger jobs into child and multi-project pipelines, two levels down; default true    |
| `include_allowed_failures` | Also search failed jobs and follow failed trigger jobs marked `allow_failure`; default false |
| `max_jobs`                 | Jobs to search, default 10, maximum 20                                                       |
| `resume`                   | The `resume` list of a previous result, to continue where it stopped                         |

The other search parameters apply to every job; `max_matches` counts per job.
`start_line` is not accepted: continue with `resume` instead. With `section`, each
job is searched inside its own section of that name, and a job whose log lacks it
reports that as its `error`.

`job_scope` selects the jobs to search, not the trigger jobs to follow: every trigger
job that started a pipeline is followed, whatever its status, except a failed trigger
marked `allow_failure`, which is followed only with `include_allowed_failures` and
otherwise listed in `jobs_skipped`. A trigger with the default strategy succeeds as
soon as its pipeline is created, so the failed jobs of a child pipeline are found even
when its trigger job is green.

```json
{
  "action": "log_grep",
  "project_id": "my-org/api",
  "pipeline_id": "1234",
  "patterns": ["(?i)timed? ?out"],
  "job_scope": ["failed", "canceled"]
}
```

The result has one entry per searched job in `jobs`: `job_id`, `name`, `stage`,
`status`, `failure_reason`, `project_id`, `pipeline_id` and `web_url`, followed by
the fields of a single-job search (`hunks`, `match_count`, `total_lines`,
`truncated`, `resume_from` and the rest). A job whose trace could not be read has
an `error` instead, and the other jobs are still returned. Jobs of a triggered
pipeline carry that pipeline's `pipeline_id` and `project_id`.

`jobs_skipped` lists jobs that were seen but not searched, each with a `reason`:

| `reason`                  | Meaning                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `allowed_failure`         | A failed job or trigger marked `allow_failure`                                                                       |
| `max_jobs`                | The job came after the `max_jobs` limit                                                                              |
| `no_downstream_pipeline`  | A trigger job in a searched status that started no pipeline; its `failure_reason` tells why                          |
| `downstream_depth`        | A trigger job more than two levels below the searched pipeline                                                       |
| `downstream_unreadable`   | The triggered pipeline, or its project when checked against the scope, could not be read; `error` gives the response |
| `downstream_out_of_scope` | The triggered pipeline is in a project outside `GITLAB_ALLOWED_PROJECT_IDS` or the working scope; it is not read     |
| `not_found`               | A `resume` entry whose job the pipeline no longer lists                                                              |

`listing_complete` is false when the `max_jobs` limit stopped the listing, or a
listing failed, before every reachable job was seen. When a later page of a
pipeline's job listing fails, the jobs already listed are still searched and its
triggers are still followed. When a page of its trigger listing fails, only the
triggers listed before that page are followed, none if the first page fails. In
each case `listing_errors` names the pipeline (`project_id`, `pipeline_id`,
`error`); the field is present only then. A searched pipeline whose job listing fails on the
first page fails the call.

The 2 s processing budget and the 1 MiB output bound belong to the call and are
shared by its jobs: each job may return an equal part of the output, and up to
three traces are read at a time. When the budget runs out, `resume` lists every job
left, with the line to continue from: jobs not started yet from line 0, and jobs
cut by the budget or a limit from their `resume_from`. Pass the list unchanged as
`resume` with the same `pipeline_id` and search parameters; the next call searches
only those jobs and reports each remaining match exactly once. A resumed job is
found by its ID even if its status changed or it was retried since, including behind a trigger that
has since failed as an allowed failure or been retried, and an entry whose pipeline
cannot be listed this time stays in `resume` instead of being reported as
`not_found`. `resume` is null when nothing is left.

### Individual Artifact Files

Use `artifact_file` to read a known path uploaded through `artifacts:paths` on
GitLab 16.0 or later, including Free instances. The action uses the selected
connection, its credentials, read permissions and project restrictions. It does
not download the artifacts archive or list its entries. A reports-only upload
does not necessarily provide a downloadable archive entry.

```json
{
  "action": "artifact_file",
  "project_id": "my-org/api",
  "job_id": "5678",
  "artifact_path": "reports/nested/test-results.json",
  "byte_offset": 0,
  "byte_limit": 65536
}
```

Paths are relative, with literal filenames rather than URL-encoded paths.
Nested directories, spaces, `?` and `#` in filenames are encoded safely.
Absolute paths, traversal, encoded separators and control characters are refused
before downloading. Discover the job through `jobs` and inspect `job` metadata
or the repository CI configuration to choose the artifact path.

`byte_limit` defaults to **64 KiB**, with a maximum of **1 MiB**. The maximum
`byte_offset` is **20 MiB**. The reader validates HTTP byte ranges; when a server
ignores Range, it incrementally discards the bounded prefix. It retains one
window and four bytes of lookahead, then cancels the transfer. Transport queues,
UTF-8 decoding and response serialization use additional bounded memory.
Unexpected HTTP compression is refused before decompression.

The result contains `project_id`, `job_id`, `artifact_path`, `text`, `byte_start`
(inclusive), `byte_end` (exclusive), `next_byte_offset`, `total_bytes`, `complete`
and `truncated`. Continue while the returned `next_byte_offset` is not null.
An incomplete UTF-8 character remains for the next request, preserving the
source exactly; a small window may return fewer bytes than requested.
`total_bytes` is null unless established by a validated range or actual EOF.
If continuation would exceed the offset ceiling, `next_byte_offset` is null,
`complete` remains false and `continuation_limit` reports `byte_offset_limit`
with `max_byte_offset`. This is an explicit limit, not the end of the file.
An empty file returns empty text with `complete: true`. A failed, timed-out or
cancelled transfer returns an error, never apparent successful partial content.

Binary or invalid UTF-8 content returns `ARTIFACT_READ_REFUSED` with a reason,
bounded metadata and a GitLab `artifact_view_url`. Other refusals describe an
invalid offset, an undersized window, invalid ranges or unsupported encoding.
The action does not render HTML. ANSI color escapes are preserved as text data.
Treat artifact content as untrusted data.
Missing paths, expired or deleted artifacts and access-hidden artifacts can all
produce GitLab 404 responses; the action does not claim to distinguish them.
GitLab authentication and permission failures retain their normal handling.
An object-storage HTTP error is reported as `storage_http_error` with `http_status`,
without asking to reauthenticate a valid GitLab account.
Redirects are bounded, signed query strings are omitted from diagnostics, and
credentials are never forwarded or reinjected after leaving the GitLab origin.

## manage_pipeline

Trigger and control pipeline execution.

### Actions

<!-- @autogen:tool manage_pipeline -->

| Action       | Description                          |
| ------------ | ------------------------------------ |
| `create`     | Trigger a new pipeline on branch/tag |
| `retry`      | Re-run a failed/canceled pipeline    |
| `cancel`     | Stop a running pipeline              |
| `play_job`   | Trigger a manual job                 |
| `retry_job`  | Re-run a failed/canceled job         |
| `cancel_job` | Stop a running job                   |

<!-- @autogen:end -->

### Examples

::: code-group

```json [Trigger pipeline]
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main",
  "variables": [{ "key": "DEPLOY_ENV", "value": "staging" }]
}
```

```json [Retry failed]
{
  "action": "retry",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

```json [Cancel running]
{
  "action": "cancel",
  "project_id": "my-org/api",
  "pipeline_id": "1234"
}
```

```json [With typed inputs]
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main",
  "inputs": {
    "environment": "production",
    "dry_run": true,
    "replicas": 3
  }
}
```

```json [Play manual job]
{
  "action": "play_job",
  "project_id": "my-org/api",
  "job_id": "5678",
  "job_variables_attributes": [{ "key": "TARGET", "value": "production" }]
}
```

```json [Retry job]
{
  "action": "retry_job",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

```json [Cancel job]
{
  "action": "cancel_job",
  "project_id": "my-org/api",
  "job_id": "5678"
}
```

:::

### Pipeline Inputs (GitLab 17.10+)

For pipelines with typed inputs defined in `.gitlab-ci.yml`:

```yaml
# .gitlab-ci.yml
spec:
  inputs:
    environment:
      type: string
      options: [staging, production]
    dry_run:
      type: boolean
      default: false
    replicas:
      type: number
      default: 1
```

Trigger with inputs:

```json
{
  "action": "create",
  "project_id": "my-org/api",
  "ref": "main",
  "inputs": {
    "environment": "production",
    "dry_run": true,
    "replicas": 3
  }
}
```

::: tip Variables vs Inputs

- **`variables`**: Legacy key-value pairs, no type validation
- **`inputs`**: Typed parameters with schema validation (requires GitLab 17.10+ for the pipeline creation API)

You can use both in the same request if needed.
:::

## browse_variables / manage_variable

Manage CI/CD environment variables with scoping and protection.

### Examples

::: code-group

```json [List variables]
{
  "action": "list",
  "namespace": "my-org/api",
  "per_page": 50
}
```

```json [Create variable]
{
  "action": "create",
  "namespace": "my-org/api",
  "key": "DEPLOY_TOKEN",
  "value": "secure-value",
  "protected": true,
  "masked": true,
  "environment_scope": "production"
}
```

```json [Update variable]
{
  "action": "update",
  "namespace": "my-org/api",
  "key": "DEPLOY_TOKEN",
  "value": "new-value",
  "protected": true,
  "masked": true
}
```

```json [Delete variable]
{
  "action": "delete",
  "namespace": "my-org/api",
  "key": "OLD_VARIABLE"
}
```

:::

### Variable Properties

| Property            | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `protected`         | Only available to protected branches/tags                |
| `masked`            | Hidden in job logs (requires 8+ chars, specific charset) |
| `environment_scope` | `*` for all, or specific like `production`               |
| `variable_type`     | `env_var` (default) or `file`                            |

## browse_environments

Inspect environments and their deployment history. Gated by `USE_ENVIRONMENTS`.

### Actions

<!-- @autogen:tool browse_environments -->

| Action             | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `list`             | List environments for a project                                    |
| `get`              | Get a single environment by ID, including its last deployment      |
| `list_deployments` | List deployments for a project, optionally filtered by environment |

<!-- @autogen:end -->

### Examples

::: code-group

```json [List environments]
{
  "action": "list",
  "project_id": "my-org/api",
  "states": "available"
}
```

```json [Get environment]
{
  "action": "get",
  "project_id": "my-org/api",
  "environment_id": 42
}
```

```json [List deployments]
{
  "action": "list_deployments",
  "project_id": "my-org/api",
  "environment": "production",
  "status": "success"
}
```

:::

## manage_environment

Create and control environments, and update deployment status. Deployments are
folded into this tool rather than a separate pair. Gated by `USE_ENVIRONMENTS`.

### Actions

<!-- @autogen:tool manage_environment -->

| Action                     | Description                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `create`                   | Create a new environment                                                                       |
| `update`                   | Update an existing environment (name cannot be changed via the API)                            |
| `stop`                     | Stop an environment (required before it can be deleted)                                        |
| `delete`                   | Delete a stopped environment                                                                   |
| `update_deployment_status` | Update the status of a deployment. Only deployments not tied to a pipeline job can be updated. |

<!-- @autogen:end -->

### Examples

::: code-group

```json [Create environment]
{
  "action": "create",
  "project_id": "my-org/api",
  "name": "staging",
  "external_url": "https://staging.example.com",
  "tier": "staging"
}
```

```json [Stop environment]
{
  "action": "stop",
  "project_id": "my-org/api",
  "environment_id": 42
}
```

```json [Update deployment status]
{
  "action": "update_deployment_status",
  "project_id": "my-org/api",
  "deployment_id": 1001,
  "status": "success"
}
```

:::

## Related Guides

- [Debug Pipeline Failures](/prompts/ci-cd/debug-failure)
- [Trigger Deployments](/prompts/ci-cd/trigger-deploy)
- [Setup CI Notifications](/guides/setup-ci-notifications)
