---
title: Instance Management CLI
description: "CLI commands for managing GitLab instances in GitLab MCP Server"
head:
  - - meta
    - name: keywords
      content: CLI, instances, management, add, remove, test, info, MCP
---

# Instance Management CLI

Commands for managing GitLab instances from the command line.

## Overview

```bash
npx @structured-world/gitlab-mcp instances <command> [options]
```

## Commands

### list

List all configured GitLab instances.

```bash
npx @structured-world/gitlab-mcp instances list
```

**Output:**

```
Configured GitLab Instances (source: file)
────────────────────────────────────────────────────────────────
  https://gitlab.com (GitLab.com) [OAuth] [Rate: 100 concurrent]
  https://git.company.io (Corporate) [OAuth] [Rate: 50 concurrent]
  https://gitlab.dev.local (Dev) [TLS: skip]

Total: 3 instance(s)
```

**Fields shown:**
- URL
- Label (if set)
- `[OAuth]` if OAuth is configured
- `[Rate: N concurrent]` if custom rate limit
- `[TLS: skip]` if TLS verification is disabled

### add

Add a new GitLab instance interactively.

```bash
npx @structured-world/gitlab-mcp instances add
```

**Interactive prompts:**

```
╭ Add GitLab Instance
│
◇ GitLab instance URL:
│ https://git.new-company.io
│
◇ Label (optional):
│ New Company GitLab
│
◇ Configure OAuth?
│ ● Yes / ○ No
│
◇ OAuth Application ID:
│ app_12345
│
◇ OAuth Secret (optional, for confidential apps):
│ ********
│
◇ Instance Configuration:
│ {
│   "url": "https://git.new-company.io",
│   "label": "New Company GitLab",
│   "oauth": {
│     "clientId": "app_12345",
│     "clientSecret": "***",
│     "scopes": "api read_user"
│   }
│ }
│
◇ Add this configuration?
│ ● Yes / ○ No
│
└ Instance configured!

To use it, add to your configuration:

Environment variable:
  GITLAB_INSTANCES="https://git.new-company.io:app_12345"

Or add to instances.yaml:
  instances:
    - url: https://git.new-company.io
      label: "New Company GitLab"
      oauth:
        clientId: "app_12345"
```

### remove

Remove a GitLab instance from configuration.

```bash
npx @structured-world/gitlab-mcp instances remove <url>
```

**Example:**

```bash
npx @structured-world/gitlab-mcp instances remove https://gitlab.old.io
```

**Output:**

```
To remove instance https://gitlab.old.io, edit your configuration file
and remove the corresponding entry from the instances array.
```

::: info
This command provides guidance rather than modifying files directly, to prevent accidental data loss.
:::

### test

Test connection to one or all GitLab instances.

```bash
# Test specific instance
npx @structured-world/gitlab-mcp instances test https://gitlab.com

# Test all configured instances
npx @structured-world/gitlab-mcp instances test
```

**Output:**

```
Testing GitLab Instance Connections
────────────────────────────────────────────────────────────────
  https://gitlab.com... ✓ Connected (v17.2.0)
  https://git.company.io... ✓ Connected (v16.8.0)
  https://gitlab.offline.io... ✗ Failed: ECONNREFUSED
```

**Status indicators:**
- `✓ Connected (vX.Y.Z)` - Successfully connected, shows GitLab version
- `✓ Reachable (authentication required)` - Instance responds but needs auth
- `✗ Error: HTTP NNN` - HTTP error response
- `✗ Failed: <message>` - Connection or other error

### info

Show detailed information about an instance.

```bash
npx @structured-world/gitlab-mcp instances info <url>
```

**Example:**

```bash
npx @structured-world/gitlab-mcp instances info https://gitlab.com
```

**Output:**

```
Instance Information: https://gitlab.com
────────────────────────────────────────────────────────────────

Configuration:
  URL: https://gitlab.com
  Label: GitLab.com
  OAuth: Enabled (client configured)
  TLS Verify: Enabled

Rate Limit Config:
  Max Concurrent: 100
  Queue Size: 500
  Queue Timeout: 60000ms

Runtime State:
  Connection: healthy
  Last Health Check: 2026-02-04T10:30:00.000Z

Rate Limit Metrics:
  Active Requests: 5/100
  Queued: 0/500
  Total Requests: 1234
  Rejected: 0
  Avg Queue Wait: 15ms

Introspection Cache:
  Version: 17.2.0
  Tier: varies (SaaS)
  Cached At: 2026-02-04T10:25:00.000Z
```

### sample-config

Generate a sample configuration file.

```bash
# YAML format (default)
npx @structured-world/gitlab-mcp instances sample-config

# Explicit YAML
npx @structured-world/gitlab-mcp instances sample-config yaml

# JSON format
npx @structured-world/gitlab-mcp instances sample-config json
```

**YAML Output:**

```yaml
# GitLab MCP Instances Configuration
# Documentation: https://gitlab-mcp.sw.foundation/configuration/instances

instances:
  # GitLab.com (SaaS)
  - url: https://gitlab.com
    label: "GitLab.com"
    oauth:
      clientId: "your_app_id_here"
      # clientSecret: "optional_for_confidential_apps"
      scopes: "api read_user"
    rateLimit:
      maxConcurrent: 100
      queueSize: 500
      queueTimeout: 60000

  # Self-hosted example
  - url: https://gitlab.example.com
    label: "Company GitLab"
    oauth:
      clientId: "company_app_id"
    rateLimit:
      maxConcurrent: 50
      queueSize: 200
      queueTimeout: 30000

defaults:
  rateLimit:
    maxConcurrent: 100
    queueSize: 500
    queueTimeout: 60000
  oauth:
    scopes: "api read_user"
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (invalid arguments, connection failure, etc.) |

## Environment Variables

The CLI respects these environment variables:

| Variable | Effect |
|----------|--------|
| `GITLAB_INSTANCES_FILE` | Config file to read instances from |
| `GITLAB_INSTANCES` | Inline instance configuration |
| `GITLAB_API_URL` | Legacy single-instance URL |

## Examples

### Setup Workflow

```bash
# 1. Generate sample config
npx @structured-world/gitlab-mcp instances sample-config yaml > instances.yaml

# 2. Edit the file with your instances
vim instances.yaml

# 3. Set environment variable
export GITLAB_INSTANCES_FILE=./instances.yaml

# 4. Verify configuration
npx @structured-world/gitlab-mcp instances list

# 5. Test connections
npx @structured-world/gitlab-mcp instances test
```

### Quick Single Instance

```bash
# Test a single GitLab instance
GITLAB_API_URL=https://gitlab.com npx @structured-world/gitlab-mcp instances test

# Show info for configured instance
npx @structured-world/gitlab-mcp instances info https://gitlab.com
```

## Related Documentation

- [Multi-Instance Setup](/guide/multi-instance) - Getting started guide
- [Instance Configuration](/configuration/instances) - Configuration reference
- [Rate Limiting](/configuration/rate-limiting) - Rate limiting details
