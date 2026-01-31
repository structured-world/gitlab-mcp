---
title: Customization
description: "Customize GitLab MCP Server — tool descriptions, profiles, presets, and feature flags"
head:
  - - meta
    - name: keywords
      content: GitLab MCP customization, tool descriptions, action filtering, schema mode, feature flags, cross-references
---

# Customization

Customize tool descriptions, filter actions, and configure schema output for optimal AI agent performance.

::: tip MCPB Users
If you installed via the [MCPB bundle](/guide/installation/claude-desktop), only the three core settings (token, URL, read-only mode) are configurable through the extension UI. For the advanced options below, switch to [manual JSON configuration](/clients/claude-desktop).
:::

## Dynamic Tool Descriptions

Override tool descriptions at runtime to optimize AI agent tool selection:

```bash
GITLAB_TOOL_{TOOL_NAME}="Your custom description"
```

Where `{TOOL_NAME}` is the uppercase version of the tool name.

### Examples

```bash
export GITLAB_TOOL_BROWSE_PROJECTS="Show all available GitLab projects in our organization"
export GITLAB_TOOL_MANAGE_MERGE_REQUEST="Create MR following our team's review process"
export GITLAB_TOOL_MANAGE_WORK_ITEM="Create and manage tickets for our sprint planning"
```

### In MCP Configuration

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "your_token",
        "GITLAB_API_URL": "https://gitlab.com",
        "GITLAB_TOOL_BROWSE_PROJECTS": "Show our team's GitLab projects",
        "GITLAB_TOOL_MANAGE_MERGE_REQUEST": "Create MR with our review standards"
      }
    }
  }
}
```

### Notes

- Only the tool description is overridden — name and functionality remain unchanged
- Schema field descriptions are NOT affected
- Tool names in variables must be UPPERCASE
- Invalid tool names are ignored with a debug warning

## Dynamic Cross-References

Tool descriptions include `Related:` sections that reference companion tools (e.g., browse→manage pairs). These references are resolved dynamically at startup — if a referenced tool is unavailable (disabled via `USE_*`, `GITLAB_DENIED_TOOLS_REGEX`, read-only mode, or tier/version gating), it is automatically stripped from the description.

### How It Works

```
# Source description (in registry):
"List labels. Related: manage_label to create/update/delete."

# If manage_label is disabled (USE_LABELS_MANAGE=false or read-only mode):
"List labels."

# If manage_label is available:
"List labels. Related: manage_label to create/update/delete."
```

### Notes

- References are identified by `browse_*` or `manage_*` prefixes in the `Related:` section
- Multiple comma-separated references are resolved individually — only unavailable ones are stripped
- If all referenced tools are unavailable, the entire `Related:` clause is removed
- Custom description overrides (`GITLAB_TOOL_*`) bypass resolution entirely — you control the full text

### Disabling Cross-References

To remove all "Related:" hints from tool descriptions:

```bash
GITLAB_CROSS_REFS=false
```

**When to disable:**
- Context-constrained agents with strict token budgets
- Deployments with very few tools enabled (cross-refs become noise)
- When using custom `GITLAB_TOOL_*` descriptions exclusively

When disabled, Related sections are stripped from all generated tool descriptions regardless of tool availability. Tools with custom `GITLAB_TOOL_*` overrides are unaffected — any `Related:` text you include in a custom description is preserved as-is.

## Fine-Grained Action Filtering

For CQRS tools, disable specific actions while keeping others available. This reduces AI context token usage by removing disabled actions and their exclusive parameters from the schema.

```bash
GITLAB_DENIED_ACTIONS="tool_name:action,tool_name:action,..."
```

### Examples

```bash
# Disable delete and promote for milestones
export GITLAB_DENIED_ACTIONS="manage_milestone:delete,manage_milestone:promote"

# Disable merge action (review-only workflow)
export GITLAB_DENIED_ACTIONS="manage_merge_request:merge"

# Read-only for specific tool
export GITLAB_DENIED_ACTIONS="manage_variable:create,manage_variable:update,manage_variable:delete"
```

### How It Works

1. **Schema Filtering** — Denied actions removed from tool's JSON schema
2. **Parameter Optimization** — Parameters exclusive to denied actions are removed
3. **Runtime Validation** — Attempts to call denied actions are rejected
4. **Token Savings** — Smaller schemas = fewer tokens consumed by AI agents

### Token Savings Example

When only `create` action is allowed for `manage_milestone`:

| State | Properties in Schema | Token Impact |
|-------|---------------------|--------------|
| All actions | 8 properties | 100% |
| Only `create` | 6 properties (milestone_id, state_event removed) | ~60% |

## Action Description Customization

Override descriptions for specific actions within CQRS tools:

```bash
# Format: GITLAB_ACTION_{TOOL}_{ACTION}="description"
export GITLAB_ACTION_MANAGE_MILESTONE_DELETE="Permanently remove milestone (requires admin)"
export GITLAB_ACTION_BROWSE_MERGE_REQUESTS_LIST="Show team's active merge requests"
```

## Parameter Description Customization

Override descriptions for specific parameters:

```bash
# Format: GITLAB_PARAM_{TOOL}_{PARAM}="description"
export GITLAB_PARAM_MANAGE_MILESTONE_NAMESPACE="Project or group path (e.g., 'myteam/myproject')"
export GITLAB_PARAM_BROWSE_WORK_ITEMS_TYPES="Filter by type: ISSUE, EPIC, TASK, etc."
```

## Schema Mode

Configure how CQRS tool schemas are delivered to AI clients:

```bash
GITLAB_SCHEMA_MODE=flat|discriminated
```

| Mode | Description | Best For |
|------|-------------|----------|
| `flat` (default) | Merged properties with action enum | Current AI clients (Claude, GPT) |
| `discriminated` | Full `oneOf` with action-specific branches | Advanced clients with native oneOf support |

### Schema Pipeline

When a tool is registered, the schema goes through:

1. **Filter Denied Actions** — Removes branches for `GITLAB_DENIED_ACTIONS`
2. **Apply Description Overrides** — Applies `GITLAB_ACTION_*` and `GITLAB_PARAM_*`
3. **Conditional Flatten** — Converts `oneOf` to flat when `GITLAB_SCHEMA_MODE=flat`

## Combined Example

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "your_token",
        "GITLAB_DENIED_ACTIONS": "manage_milestone:delete",
        "GITLAB_TOOL_MANAGE_MILESTONE": "Manage sprint milestones for our team",
        "GITLAB_ACTION_MANAGE_MILESTONE_CREATE": "Create new sprint milestone",
        "GITLAB_PARAM_MANAGE_MILESTONE_TITLE": "Sprint name (e.g., 'Sprint 42')"
      }
    }
  }
}
```
