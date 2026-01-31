---
title: Read-Only Mode
description: "Enable read-only mode for GitLab MCP Server — safe operation restricting all write operations"
head:
  - - meta
    - name: keywords
      content: GitLab MCP read-only, safe mode, write protection, production monitoring, tool availability
---

# Read-Only Mode

Restrict the server to only expose read-only operations.

## Configuration

```bash
GITLAB_READ_ONLY_MODE=true
```

## Behavior

When enabled:
- Only `browse_*` and other read-only tools are available
- All `manage_*` tools are hidden from the tool list
- `manage_context` is the sole exception (session context, no GitLab data modification)
- Write operations return an error if attempted
- Useful for production environments or when write access is not needed

## Use Cases

- **Production monitoring** — Safely browse projects, MRs, and pipelines
- **Cursor/Windsurf** — Stay within the 40-tool limit by hiding write tools
- **Shared access** — Give agents read access without risk of modifications
- **Auditing** — Browse activity and history without accidental changes

## Tool Availability

| Tool Pattern | Read-Only Mode | Full Mode |
|-------------|----------------|-----------|
| `browse_*` | Available | Available |
| `manage_*` | Hidden | Available |
| `list_*` | Available | Available |
| `get_*` | Available | Available |
| `create_*` | Hidden | Available |
