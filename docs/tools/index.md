---
title: Tool Reference
description: "Complete reference for 44 GitLab MCP tools across 18 entity types — browse and manage operations"
---

# Tool Reference

GitLab MCP Server provides **44 tools** across 18 entity types.

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

### Members (`USE_MEMBERS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_members` | Query | Browse team members |
| `manage_member` | Command | Add/remove team members |

### Search (`USE_SEARCH=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_search` | Query | Search across GitLab |

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

### Milestones (`USE_MILESTONE=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_milestones` | Query | List, get, issues, MRs, burndown |
| `manage_milestone` | Command | Create, update, delete, promote |

### Pipelines (`USE_PIPELINE=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_pipelines` | Query | List pipelines, jobs, logs |
| `manage_pipeline` | Command | Create, retry, cancel pipelines |
| `manage_pipeline_job` | Command | Play, retry, cancel jobs |

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
| `manage_pipeline_job` | ★ | ★★★ | — | — |
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
| **Jobs** | — (via browse_pipelines) | `manage_pipeline_job` (play, retry, cancel) |
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

For complete parameter documentation, action matrices, and example requests, see the auto-generated [Full API Reference](/TOOLS).

Generate locally:

```bash
yarn list-tools --export --toc > docs/TOOLS.md
```
