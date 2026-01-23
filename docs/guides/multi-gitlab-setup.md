# Multi-GitLab Setup

Configure GitLab MCP to work with multiple GitLab instances using context management and profiles.

## Overview

Many organizations use multiple GitLab instances — a self-hosted instance for internal projects and GitLab.com for open-source work. GitLab MCP supports switching between instances using the context management system.

**Tools used:** `manage_context`

## Understanding Context

The context system manages your current session configuration:
- **Host** — Which GitLab instance you're connected to
- **Preset** — Predefined configuration profiles
- **Scope** — Restrict operations to a specific namespace
- **Mode** — Authentication mode (PAT or OAuth)

### View Current Context

> "Show me my current GitLab context"

```json
// manage_context
{
  "action": "show"
}
```

This returns your active host, preset, scope, and authentication mode.

## Setting Up Presets

Presets are predefined configurations you can switch between. They're configured via environment variables at startup.

### Example Configuration

```bash
# .env file for multiple instances

# Instance 1: Company GitLab (default)
GITLAB_API_URL=https://gitlab.company.com/api/v4
GITLAB_TOKEN=glpat-company-token

# Instance 2: GitLab.com (via preset)
# Presets are defined in the server configuration
```

### List Available Presets

> "What presets are available?"

```json
// manage_context
{
  "action": "list_presets"
}
```

### Switch Between Presets

> "Switch to the `open-source` preset for GitLab.com work"

```json
// manage_context
{
  "action": "switch_preset",
  "preset": "open-source"
}
```

## Scoping to a Namespace

Restrict all operations to a specific group or project. This is useful when working within a team boundary.

### Scope to a Group

> "Focus all operations on the `backend` group"

```json
// manage_context
{
  "action": "set_scope",
  "namespace": "backend",
  "includeSubgroups": true
}
```

All subsequent `browse_*` and `manage_*` operations will be limited to this namespace.

### Scope to a Project

> "Scope to `my-org/api` only"

```json
// manage_context
{
  "action": "set_scope",
  "namespace": "my-org/api"
}
```

### Reset Scope

> "Remove the namespace restriction"

```json
// manage_context
{
  "action": "reset"
}
```

## OAuth Profiles (OAuth Mode)

When using OAuth authentication, you can manage multiple user profiles.

### List OAuth Profiles

> "Show me available OAuth profiles"

```json
// manage_context
{
  "action": "list_profiles"
}
```

### Switch OAuth Profile

> "Switch to the ops team profile"

```json
// manage_context
{
  "action": "switch_profile",
  "profile": "ops-team"
}
```

## Workflow: Switching Between Instances

### Morning: Internal Work

```
1. Context shows company GitLab (default)
2. "Show me my open MRs in the backend group"
3. "Review MR !42 in internal/api"
4. Work on internal projects...
```

### Afternoon: Open Source

```
1. "Switch to the open-source preset"
2. "List my todos on GitLab.com"
3. "Check pipeline status for my-oss/library"
4. Work on public projects...
```

### Back to Internal

```
1. "Switch back to the default preset"
2. "Continue reviewing internal MRs"
```

## Configuration Tips

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GITLAB_API_URL` | API endpoint for the instance |
| `GITLAB_TOKEN` | Personal access token |
| `GITLAB_PROJECT_ID` | Default project scope |
| `GITLAB_ALLOWED_PROJECT_IDS` | Restrict to specific projects |

### Security Considerations

- Use different tokens for each instance
- Apply minimum required scopes per token
- Use read-only mode for production instances
- Consider OAuth for multi-user environments

### Self-Hosted Setup

For self-hosted GitLab instances:

```bash
# Corporate instance
GITLAB_API_URL=https://gitlab.internal.company.com/api/v4
GITLAB_TOKEN=glpat-internal-token

# Additional settings for self-hosted
# TLS verification, custom CA, etc.
```

See the [TLS/HTTPS guide](/advanced/tls) for self-hosted certificate configuration.

## Troubleshooting

### "Not authorized" errors after switching

- Verify the token for the target instance is valid
- Check token scopes match required operations
- Ensure the API URL is correct (include `/api/v4`)

### Scope not applying

- Verify the namespace path is correct
- Check if the namespace is a group vs project
- Use `show` action to confirm current context

### Can't switch presets

- Verify presets are configured in the server
- Use `list_presets` to see available options
- Check server startup logs for preset loading errors
