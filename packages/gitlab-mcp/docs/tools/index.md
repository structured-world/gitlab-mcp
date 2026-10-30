---
title: Tool Reference
description: "Complete reference for 64 GitLab MCP tools across 26 entity types. Explore browse_* query and manage_* command operations organized by category with feature flags."
head:
  - - meta
    - name: keywords
      content: gitlab mcp tools, tool reference, browse commands, manage commands, cqrs pattern, gitlab api operations
---

# Tool Reference

GitLab MCP Server provides **64 tools** across 26 entity types.

## Architecture

Tools follow the **CQRS pattern**:
- **`browse_*`** — Read-only query operations
- **`manage_*`** — Write/command operations

Each tool accepts an `action` parameter selecting the specific operation.

## Tool Categories

### Core (Always Available)

| Tool | Type | Description |
|------|------|-------------|
| `browse_projects` | Query | Find, browse, or inspect projects |
| `manage_project` | Command | Create, fork, update, delete, archive, transfer projects |
| `browse_namespaces` | Query | Explore groups and namespaces |
| `manage_namespace` | Command | Create, update, delete groups |
| `browse_commits` | Query | Explore commit history |
| `browse_events` | Query | Track activity feeds |
| `browse_users` | Query | Search users |
| `browse_todos` | Query | View todo notifications |
| `manage_todos` | Command | Mark todos done/restore |
| `manage_context` | Mixed | Manage session context |

### Iterations (`USE_ITERATIONS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_iterations` | Query | List and get group iterations (Premium) |

### Releases (`USE_RELEASES=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_releases` | Query | Browse project releases |
| `manage_release` | Command | Create/update releases |

### Refs (`USE_REFS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_refs` | Query | Browse branches and tags |
| `manage_ref` | Command | Create/protect branches and tags |

Protected-tag listing, protection and unprotection are available on every GitLab
tier. For branch and tag protection, `allowed_to_*` access lists are available in
EE: role entries (`access_level`) work on Free EE, while individual user/group
grants require Premium or Ultimate and the appropriate project membership.
Code-owner approval requires Premium or Ultimate.

Protection changes are checked against the returned GitLab entity. If GitLab
ignores a requested access entry, `unprotect_access_level` or code-owner setting, the result includes
`not_applied` with the setting name (including the input array index), requested
value and required capability. Other changes may already have taken effect;
inspect the returned protection before retrying. Fully applied responses retain
their usual shape. CE callers can use `create_access_level`, `push_access_level`
and `merge_access_level` for role-based protection.
The standalone `unprotect_access_level` parameter requires EE too; it is checked
against the returned `unprotect_access_levels`, including when CE ignores it.

These capabilities are verified against GitLab 16.0 sources:
[protected tags](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/lib/api/protected_tags.rb),
[EE access-list parameters](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/ee/lib/ee/api/helpers/protected_branches_helpers.rb),
[role and licensed user/group grants](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/ee/app/models/concerns/ee/protected_ref_access.rb),
and [code-owner approval](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/ee/app/services/ee/protected_branches/api_service.rb).

### Members (`USE_MEMBERS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_members` | Query | Browse team members |
| `manage_member` | Command | Add/remove team members |

### Search (`USE_SEARCH=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_search` | Query | Search across GitLab |

For global or group searches, `blobs` needs Advanced Search or exact code search;
`commits`, `notes` and `wiki_blobs` need Advanced Search. Availability depends on
the instance configuration and the search target, not just its licensed tier.
When GitLab rejects one of these scopes as unavailable, the tool explains how to
use `action: "project"` with `project_id` and the same scope instead. Project
search remains available without a cross-project search backend. The tool does
not retry the request or automatically search additional projects.

### Labels (`USE_LABELS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_labels` | Query | List and get labels |
| `manage_label` | Command | Create, update, delete labels |

### Merge Requests (`USE_MRS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_merge_requests` | Query | List, get, diffs, compare MRs |
| `browse_mr_discussions` | Query | List discussions and draft notes |
| `manage_merge_request` | Command | Create, update, merge MRs |
| `manage_mr_discussion` | Command | Comment, thread, reply, resolve |
| `manage_draft_notes` | Command | Create, publish, delete drafts |

### Files (`USE_FILES=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_files` | Query | Tree listing, file content, download attachments |
| `manage_files` | Command | Create, update, upload files |

### CI/CD Variables (`USE_VARIABLES=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_variables` | Query | List and get variables |
| `manage_variable` | Command | Create, update, delete variables |

### Work Items (`USE_WORKITEMS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_work_items` | Query | List and get issues/epics/tasks |
| `manage_work_item` | Command | Create, update, delete work items |

### Webhooks (`USE_WEBHOOKS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_webhooks` | Query | List project/group webhooks |
| `manage_webhook` | Command | Create, update, delete, test webhooks |

### Snippets (`USE_SNIPPETS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_snippets` | Query | List personal/project/public snippets |
| `manage_snippet` | Command | Create, update, delete snippets |

### Integrations (`USE_INTEGRATIONS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_integrations` | Query | List active project integrations |
| `manage_integration` | Command | Update, disable integrations |

### Wiki (`USE_GITLAB_WIKI=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_wiki` | Query | List and get wiki pages |
| `manage_wiki` | Command | Create, update, delete wiki pages |

For `manage_wiki` updates, omit `title` to preserve the page's current slug and URL
when changing `content` or `format`, including nested pages. An explicit `title`
renames the page and can change its URL: a leaf-only title stays in the current
directory, while a title containing `/` supplies the full destination path.

### Milestones (`USE_MILESTONE=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_milestones` | Query | List, get, issues, MRs, burndown |
| `manage_milestone` | Command | Create, update, delete, promote |

### Pipelines (`USE_PIPELINE=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_pipelines` | Query | List pipelines, jobs, logs |
| `manage_pipeline` | Command | Create, retry, cancel pipelines; play, retry, cancel jobs |

## Tools by Use-Case

For workflow-oriented documentation with examples:

- [Code Review](/tools/code-review) — MRs, diffs, discussions, suggestions
- [CI/CD](/tools/ci-cd) — Pipelines, jobs, logs, variables
- [Project Management](/tools/project-management) — Issues, milestones, labels, members
- [Repository](/tools/repository) — Files, commits, branches, releases

## Tool Comparison by Role

Which tools matter most for each role:

| Tool | Developer | DevOps | Team Lead | PM |
|------|:---------:|:------:|:---------:|:--:|
| `browse_merge_requests` | ★★★ | ★ | ★★★ | ★ |
| `manage_merge_request` | ★★★ | ★ | ★★★ | — |
| `manage_mr_discussion` | ★★★ | — | ★★★ | — |
| `browse_pipelines` | ★★ | ★★★ | ★ | — |
| `manage_pipeline` | ★ | ★★★ | — | — |
| `browse_variables` | ★ | ★★★ | — | — |
| `manage_variable` | — | ★★★ | — | — |
| `browse_files` | ★★★ | ★ | ★ | — |
| `manage_files` | ★★ | ★ | — | — |
| `browse_commits` | ★★ | ★ | ★ | — |
| `browse_work_items` | ★★ | ★ | ★★★ | ★★★ |
| `manage_work_item` | ★★ | ★ | ★★★ | ★★★ |
| `browse_milestones` | ★ | — | ★★★ | ★★★ |
| `manage_milestone` | — | — | ★★ | ★★★ |
| `browse_labels` | ★ | — | ★★ | ★★★ |
| `manage_label` | — | — | ★★ | ★★★ |
| `browse_members` | ★ | ★ | ★★★ | ★★ |
| `manage_member` | — | ★ | ★★★ | — |
| `browse_webhooks` | — | ★★★ | ★ | — |
| `manage_webhook` | — | ★★★ | ★ | — |
| `browse_integrations` | — | ★★★ | ★ | — |
| `browse_releases` | ★ | ★★ | ★ | ★★ |
| `manage_release` | ★ | ★★★ | ★ | ★★ |
| `browse_refs` | ★★ | ★★★ | ★ | — |
| `browse_search` | ★★ | ★ | ★★ | ★ |

★★★ = Primary tool &nbsp;|&nbsp; ★★ = Frequently used &nbsp;|&nbsp; ★ = Occasionally &nbsp;|&nbsp; — = Rarely needed

See [role-based prompts](/prompts/by-role/developer) for workflows tailored to each role.

## Query vs Command Comparison

| Category | Query (browse_*) | Command (manage_*) |
|----------|-------------------|---------------------|
| **Projects** | `browse_projects` (search, list, get) | `manage_project` (create, fork, update, delete, archive, transfer) |
| **Namespaces** | `browse_namespaces` (list, get, verify) | `manage_namespace` (create, update, delete) |
| **Merge Requests** | `browse_merge_requests` (list, get, diffs, compare) | `manage_merge_request` (create, update, merge, approve) |
| **Discussions** | `browse_mr_discussions` (list, drafts, draft) | `manage_mr_discussion` (comment, thread, suggest, resolve) |
| **Pipelines** | `browse_pipelines` (list, get, jobs, logs) | `manage_pipeline` (create, retry, cancel) |
| **Jobs** | — (via browse_pipelines) | `manage_pipeline` (play_job, retry_job, cancel_job) |
| **Variables** | `browse_variables` (list, get) | `manage_variable` (create, update, delete) |
| **Files** | `browse_files` (tree, content, download_attachment) | `manage_files` (single, batch, upload) |
| **Work Items** | `browse_work_items` (list, get) | `manage_work_item` (create, update, delete) |
| **Milestones** | `browse_milestones` (list, get, issues, burndown) | `manage_milestone` (create, update, delete, promote) |
| **Labels** | `browse_labels` (list, get) | `manage_label` (create, update, delete) |
| **Iterations** | `browse_iterations` (list, get) | — |
| **Releases** | `browse_releases` (list, get, assets) | `manage_release` (create, update, delete, links) |
| **Refs** | `browse_refs` (branches, tags, protection) | `manage_ref` (create, delete, protect) |
| **Members** | `browse_members` (list, get) | `manage_member` (add, remove, update) |
| **Webhooks** | `browse_webhooks` (list, get) | `manage_webhook` (create, update, delete, test) |
| **Integrations** | `browse_integrations` (list, get) | `manage_integration` (update, disable) |
| **Wiki** | `browse_wiki` (list, get) | `manage_wiki` (create, update, delete) |
| **Snippets** | `browse_snippets` (list, get) | `manage_snippet` (create, update, delete) |
| **Users** | `browse_users` (search, get) | — |
| **Todos** | `browse_todos` (list) | `manage_todos` (done, done_all, restore) |

## Detailed Documentation

For complete parameter documentation, action matrices, and example requests, see the auto-generated [Full API Reference](/tools/api-reference).

Generate locally:

```bash
yarn list-tools --export --toc > docs/tools/api-reference.md
```
