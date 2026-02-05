---
title: Context Switching
description: "Understand GitLab MCP context switching between instances. Learn how OAuth and static token modes handle instance changes, tool re-validation, namespace caching, and preset configuration."
head:
  - - meta
    - name: keywords
      content: context switching, instance switching, OAuth, static token, manage_context, MCP
---

# GitLab Instance Context Switching

How GitLab MCP handles switching between GitLab instances depending on authentication mode.

## Behavior by Auth Mode

| Mode | Instance Switching | Required Action |
|------|-------------------|-----------------|
| OAuth | **Blocked** | User must re-authenticate |
| Static Token | Allowed via `manage_context` | Re-introspection + tool validation |

## OAuth Mode

In OAuth mode, the session is tied to a specific GitLab instance:

```
User → OAuth Flow → Instance Selection → Authentication → Session
                          ↓
                   Session bound to
                   selected instance
```

### Why Switching is Blocked

OAuth tokens are issued by a specific GitLab instance. Using an OAuth token from gitlab.com against git.company.io would fail authentication.

### How to Switch Instances

To work with a different instance in OAuth mode:

1. End current session (logout)
2. Initiate new OAuth flow
3. Select the desired instance
4. Authenticate with that instance

```json
// Attempting to switch in OAuth mode
// manage_context
{
  "action": "switch_instance",
  "instanceUrl": "https://git.company.io"
}

// Error response
{
  "error": "Cannot switch instances in OAuth mode. Please re-authenticate with the desired GitLab instance."
}
```

## Static Token Mode

In static token mode (using `GITLAB_TOKEN`), instance switching is allowed via `manage_context`.

### Switching Instances

```json
// manage_context
{
  "action": "switch_instance",
  "instanceUrl": "https://git.company.io"
}
```

### What Happens on Switch

1. **Validate instance** - Check instance is registered
2. **Clear namespace cache** - Old tier data is invalid
3. **Re-introspect** - Fetch version and schema for new instance
4. **Re-validate tools** - Check tools against new schema
5. **Notify client** - Send `tools/list_changed` if tools changed

### Response Format

```json
{
  "success": true,
  "instance": "https://git.company.io",
  "label": "Corporate GitLab",
  "version": "16.8.0",
  "availableTools": 42,
  "disabledTools": [
    "manage_work_items",  // Work Items API not available in v16.8
    "browse_iterations"   // Requires newer version
  ],
  "message": "Switched to Corporate GitLab (v16.8.0). 2 tools disabled due to schema differences."
}
```

## Tool Re-validation

Different GitLab versions have different GraphQL schemas. When switching instances:

### Schema Validation

Tools declare required GraphQL types and widgets:

```typescript
const manageWorkItemsTool = {
  name: 'manage_work_items',
  requiredGraphQLTypes: ['WorkItem', 'WorkItemType'],
  requiredWidgets: ['DESCRIPTION', 'LABELS', 'ASSIGNEES'],
  // ...
};
```

On instance switch:
1. Fetch GraphQL schema for new instance
2. Check each tool's requirements against schema
3. Disable tools with missing types/widgets
4. Report disabled tools to user

### Version Compatibility

| GitLab Version | Work Items API | Iterations | OKRs |
|----------------|----------------|------------|------|
| 17.0+ | Full support | Full | Full |
| 16.x | Partial | Full | Limited |
| 15.x | Not available | Partial | Not available |

## Namespace Tier Cache

When switching instances:

```
Before switch:
  Session namespace cache:
    "gitlab-org" → Ultimate
    "my-group" → Free

After switch:
  Session namespace cache:
    (cleared - invalid for new instance)
```

The cache is cleared because:
- Namespace paths may not exist on new instance
- Same path may have different tier on new instance
- Old cache data would cause incorrect feature checks

## Multi-Token Presets

For advanced setups, you can configure presets with different tokens for different instances:

```yaml
# profiles.yaml
presets:
  gitlab-com:
    host: https://gitlab.com
    token: glpat-gitlab-token

  corporate:
    host: https://git.company.io
    token: glpat-corporate-token
```

Switch between presets:

```json
// manage_context
{
  "action": "switch_preset",
  "preset": "corporate"
}
```

This also triggers re-introspection and tool validation.

## Best Practices

### OAuth Mode

- Configure all needed instances upfront
- Use instance labels for easy identification
- Plan workflows around single-instance sessions

### Static Token Mode

- Use presets for frequently-switched instances
- Ensure tokens have appropriate scopes for each instance
- Be aware of tool availability differences between versions

### Mixed Environments

If your team uses both OAuth and static tokens:
- OAuth users: One session per instance
- Static token users: Can switch freely
- Document which approach each team member uses

## Related Documentation

- [Multi-Instance Setup](/guide/multi-instance) - Getting started guide
- [Federation Architecture](/advanced/federation) - Technical deep dive
- [Tier Detection](/advanced/tier-detection) - Namespace tier detection
- [Configuration Reference](/configuration/instances) - Configuration options
