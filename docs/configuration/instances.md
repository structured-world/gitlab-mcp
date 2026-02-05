---
title: Instance Configuration
description: "Complete reference for configuring multiple GitLab instances in GitLab MCP. Learn YAML/JSON configuration, OAuth setup, rate limiting, TLS settings, and environment variable formats."
head:
  - - meta
    - name: keywords
      content: instance configuration, YAML, JSON, environment variables, OAuth, rate limiting, MCP
---

# Instance Configuration

Complete reference for configuring multiple GitLab instances.

## Configuration Methods

### 1. Configuration File (Recommended)

Set `GITLAB_INSTANCES_FILE` to point to a YAML or JSON config file:

```bash
GITLAB_INSTANCES_FILE=~/.config/gitlab-mcp/instances.yaml
```

### 2. Environment Variable

Use `GITLAB_INSTANCES` for simpler setups:

```bash
# Single URL
GITLAB_INSTANCES=https://gitlab.com

# Multiple URLs (space-separated)
GITLAB_INSTANCES="https://gitlab.com https://git.company.io"

# With OAuth credentials (url:clientId:clientSecret)
GITLAB_INSTANCES="https://gitlab.com:app_id https://git.company.io:app_id:secret"
```

### 3. Legacy Single Instance

For backwards compatibility:

```bash
GITLAB_API_URL=https://gitlab.com
GITLAB_TOKEN=glpat-your-token
```

## YAML Configuration

Full-featured YAML format:

```yaml
# GitLab MCP Instances Configuration
# ~/.config/gitlab-mcp/instances.yaml

instances:
  # Minimal configuration
  - url: https://gitlab.com
    label: "GitLab.com"

  # Full configuration with OAuth
  - url: https://git.company.io
    label: "Corporate GitLab"
    oauth:
      clientId: "your_app_id"
      clientSecret: "your_secret"    # Optional for public apps
      scopes: "api read_user"        # Optional, default: api read_user
    rateLimit:
      maxConcurrent: 50              # Max parallel requests
      queueSize: 200                 # Max queued requests
      queueTimeout: 30000            # Queue wait timeout (ms)

  # Self-hosted with TLS skip (development only!)
  - url: https://gitlab.dev.local
    label: "Dev Instance"
    insecureSkipVerify: true
    rateLimit:
      maxConcurrent: 20

# Global defaults (applied to all instances unless overridden)
defaults:
  rateLimit:
    maxConcurrent: 100
    queueSize: 500
    queueTimeout: 60000
  oauth:
    scopes: "api read_user"
```

## JSON Configuration

Equivalent JSON format:

```json
{
  "instances": [
    {
      "url": "https://gitlab.com",
      "label": "GitLab.com"
    },
    {
      "url": "https://git.company.io",
      "label": "Corporate GitLab",
      "oauth": {
        "clientId": "your_app_id",
        "clientSecret": "your_secret",
        "scopes": "api read_user"
      },
      "rateLimit": {
        "maxConcurrent": 50,
        "queueSize": 200,
        "queueTimeout": 30000
      }
    }
  ],
  "defaults": {
    "rateLimit": {
      "maxConcurrent": 100,
      "queueSize": 500,
      "queueTimeout": 60000
    }
  }
}
```

## Configuration Schema

### Instance Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | GitLab instance URL (e.g., `https://gitlab.com`) |
| `label` | string | No | Human-readable name for UI |
| `oauth` | object | No | OAuth configuration |
| `rateLimit` | object | No | Rate limiting configuration |
| `insecureSkipVerify` | boolean | No | Skip TLS verification (dev only!) |

### OAuth Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Yes | GitLab OAuth Application ID |
| `clientSecret` | string | No | Client secret (for confidential apps) |
| `scopes` | string | No | OAuth scopes (default: `api read_user`) |

### RateLimit Object

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxConcurrent` | number | 100 | Maximum parallel requests |
| `queueSize` | number | 500 | Maximum queued requests |
| `queueTimeout` | number | 60000 | Queue wait timeout in ms |

### Defaults Object

| Field | Type | Description |
|-------|------|-------------|
| `rateLimit` | object | Default rate limit for all instances |
| `oauth` | object | Default OAuth settings |

## Environment Variable Formats

### Simple URL

```bash
GITLAB_INSTANCES=https://gitlab.com
```

### Multiple URLs

```bash
# Space-separated
GITLAB_INSTANCES="https://gitlab.com https://git.company.io"

# Bash array syntax
GITLAB_INSTANCES=(
  https://gitlab.com
  https://git.company.io
)
```

### With OAuth Credentials

```bash
# URL:clientId
GITLAB_INSTANCES="https://gitlab.com:app_123"

# URL:clientId:clientSecret
GITLAB_INSTANCES="https://git.company.io:app_456:secret_789"

# Mixed
GITLAB_INSTANCES="https://gitlab.com:app_123 https://git.company.io:app_456:secret_789"
```

## Configuration Priority

Configuration is loaded in this order:

1. `GITLAB_INSTANCES_FILE` - File path takes highest priority
2. `GITLAB_INSTANCES` - Environment variable
3. `GITLAB_API_URL` - Legacy single-instance mode
4. Default (`https://gitlab.com`) - If nothing else configured

## Generating Sample Config

Generate a sample configuration file:

```bash
# YAML format (default)
npx @structured-world/gitlab-mcp instances sample-config yaml

# JSON format
npx @structured-world/gitlab-mcp instances sample-config json
```

## Validation

Configuration is validated on startup using Zod schemas. Invalid configurations will produce clear error messages:

```
Error: Invalid instance configuration:
  - instances[1].url: Invalid URL format
  - instances[1].rateLimit.maxConcurrent: Expected number, received string
```

## Security Considerations

### Secrets in Config Files

::: warning
Never commit configuration files with secrets to version control!
:::

Options for managing secrets:

1. **Environment variable substitution** (if supported by your setup)
2. **Separate secrets file** with restricted permissions
3. **Secret manager integration** (HashiCorp Vault, AWS Secrets Manager, etc.)

### File Permissions

Restrict access to configuration files:

```bash
chmod 600 ~/.config/gitlab-mcp/instances.yaml
```

### TLS Verification

Only use `insecureSkipVerify: true` for development. In production, always use valid TLS certificates.

## Related Documentation

- [Multi-Instance Setup](/guide/multi-instance) - Getting started guide
- [Rate Limiting](/configuration/rate-limiting) - Rate limiting details
- [OAuth Setup](/security/oauth) - OAuth configuration guide
