---
title: Multi-Instance GitLab Setup
description: "Configure GitLab MCP Server to work with multiple GitLab instances simultaneously. Per-instance OAuth, rate limiting, and namespace tier detection for GitLab.com and self-hosted instances."
head:
  - - meta
    - name: keywords
      content: multiple GitLab instances, multi-instance, federation, OAuth, self-hosted GitLab, MCP
---

# Multi-Instance GitLab Setup

Configure GitLab MCP to work with multiple GitLab instances simultaneously with per-instance OAuth, rate limiting, and proper namespace tier detection.

## Overview

Organizations often work with multiple GitLab instances:
- **GitLab.com** for open-source projects
- **Self-hosted GitLab** for internal/proprietary work
- **Multiple self-hosted instances** for different teams or clients

GitLab MCP supports connecting to multiple instances with:
- Per-instance OAuth applications
- Per-instance rate limiting
- Per-namespace tier detection (critical for gitlab.com)
- Automatic schema introspection per instance

## Quick Start

### Single Instance (Existing Behavior)

The simplest setup uses a single GitLab instance:

```bash
GITLAB_API_URL=https://gitlab.com
GITLAB_TOKEN=glpat-your-token
```

### Multiple Instances via Environment

Configure multiple instances using `GITLAB_INSTANCES`:

```bash
# Simple URL list
GITLAB_INSTANCES="https://gitlab.com https://git.company.io"

# With OAuth credentials (url:clientId or url:clientId:clientSecret)
GITLAB_INSTANCES="https://gitlab.com:app_id_1 https://git.company.io:app_id_2:secret_2"
```

### Multiple Instances via Configuration File

For complex setups, use a configuration file:

```bash
GITLAB_INSTANCES_FILE=~/.config/gitlab-mcp/instances.yaml
```

See [Configuration Reference](/configuration/instances) for file format details.

## Configuration Priority

Configuration is loaded in this order (first match wins):

1. `GITLAB_INSTANCES_FILE` - Path to YAML/JSON config file
2. `GITLAB_INSTANCES` - Environment variable (URL, array, or JSON)
3. `GITLAB_API_URL` + `GITLAB_TOKEN` - Legacy single-instance mode
4. Auto-discovery from git remote (if enabled)

## Instance Selection in OAuth Flow

When OAuth is enabled and more than one instance has an OAuth application configured, the sign-in starts on a page that lists those instances:

```
Choose the GitLab instance to sign in to

  GitLab.com
  https://gitlab.com

  Corporate GitLab
  https://git.corp.io
```

Each entry shows the instance address, below its label when one is set; choosing one continues to that GitLab's login. The selected instance is the session's first account. To work with another instance, or another account on the same one, a chat links it with `manage_context link_account` and switches with `switch_account`, without a new connection; see [Context Switching](/advanced/context-switching).

## Tier Detection per Namespace

::: warning Critical Concept
**Tier is per-NAMESPACE, not per-instance!** On gitlab.com, a single user can access Free, Premium, and Ultimate namespaces simultaneously.
:::

GitLab MCP detects tier per namespace via GraphQL:
- Tier is cached per-session with 5-minute TTL
- Different namespaces may have different tiers
- Features are validated against namespace tier

Example: User has access to:
- `my-free-group` (Free tier) - no epics
- `company/premium-proj` (Premium tier) - epics available
- `enterprise-client` (Ultimate tier) - all features

See [Tier Detection](/advanced/tier-detection) for technical details.

## CLI Commands

Manage instances via CLI:

```bash
# List configured instances
npx @structured-world/gitlab-mcp instances list

# Add a new instance
npx @structured-world/gitlab-mcp instances add

# Test connectivity
npx @structured-world/gitlab-mcp instances test https://gitlab.com

# Show detailed info
npx @structured-world/gitlab-mcp instances info https://gitlab.com

# Generate sample config
npx @structured-world/gitlab-mcp instances sample-config yaml
```

See [CLI Reference](/cli/instances) for all commands.

## Rate Limiting

Each instance has independent rate limiting:

```yaml
instances:
  - url: https://gitlab.com
    rateLimit:
      maxConcurrent: 100    # Max parallel requests
      queueSize: 500        # Max queued requests
      queueTimeout: 60000   # Queue wait timeout (ms)
```

See [Rate Limiting Configuration](/configuration/rate-limiting) for details.

## Related Documentation

- [Configuration Reference](/configuration/instances) - All configuration options
- [Federation Architecture](/advanced/federation) - Technical deep dive
- [Tier Detection](/advanced/tier-detection) - How namespace tier detection works
- [Context Switching](/advanced/context-switching) - Accounts of a connection and how each chat switches between them
- [CLI Commands](/cli/instances) - Instance management commands
