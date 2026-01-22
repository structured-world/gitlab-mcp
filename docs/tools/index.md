# Tool Reference

GitLab MCP Server provides **47 tools** across 17 entity types.

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
| `manage_repository` | Command | Create or fork projects |
| `browse_namespaces` | Query | Explore groups and namespaces |
| `create_group` | Command | Create groups/namespaces |
| `browse_commits` | Query | Explore commit history |
| `create_branch` | Command | Create branches |
| `browse_events` | Query | Track activity feeds |
| `list_group_iterations` | Query | List sprints (Premium) |
| `get_users` | Query | Search users |
| `download_attachment` | Query | Download issue/MR attachments |
| `list_todos` | Query | View todo notifications |
| `manage_todos` | Command | Mark todos done/restore |
| `manage_context` | Mixed | Manage session context |
| `list_project_members` | Query | List project members |
| `browse_search` | Query | Search across GitLab |
| `browse_releases` | Query | Browse project releases |
| `manage_release` | Command | Create/update releases |
| `browse_refs` | Query | Browse branches and tags |
| `manage_ref` | Command | Create/protect branches and tags |
| `browse_members` | Query | Browse team members |
| `manage_member` | Command | Add/remove team members |

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
| `browse_files` | Query | Tree listing and file content |
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
| `list_webhooks` | Query | List project/group webhooks |
| `manage_webhook` | Command | CRUD + test webhooks |

### Snippets (`USE_SNIPPETS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_snippets` | Query | List personal/project/public snippets |
| `manage_snippet` | Command | Create, update, delete snippets |

### Integrations (`USE_INTEGRATIONS=true`, default: enabled)

| Tool | Type | Description |
|------|------|-------------|
| `list_integrations` | Query | List active project integrations |
| `manage_integration` | Command | Get, update, disable integrations |

### Wiki (`USE_GITLAB_WIKI=true`, default: disabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_wiki` | Query | List and get wiki pages |
| `manage_wiki` | Command | Create, update, delete wiki pages |

### Milestones (`USE_MILESTONE=true`, default: disabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_milestones` | Query | List, get, issues, MRs, burndown |
| `manage_milestone` | Command | Create, update, delete, promote |

### Pipelines (`USE_PIPELINE=true`, default: disabled)

| Tool | Type | Description |
|------|------|-------------|
| `browse_pipelines` | Query | List pipelines, jobs, logs |
| `manage_pipeline` | Command | Create, retry, cancel pipelines |
| `manage_pipeline_job` | Command | Play, retry, cancel jobs |

## Detailed Documentation

For complete parameter documentation, action matrices, and example requests, see the auto-generated [TOOLS.md](https://github.com/structured-world/gitlab-mcp/blob/main/docs/TOOLS.md).

Generate locally:

```bash
yarn list-tools --export --toc > docs/TOOLS.md
```
