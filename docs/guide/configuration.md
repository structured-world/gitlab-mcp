---
title: GitLab MCP Environment Variables
description: "Complete environment variables reference for GitLab MCP Server. Configure authentication, API settings, feature flags, OAuth, TLS, logging, and tool filtering with detailed examples."
head:
  - - meta
    - name: keywords
      content: gitlab mcp configuration, environment variables, feature flags, api settings, oauth configuration, tls https, logging, schema mode
---

# GitLab MCP Environment Variables

Complete reference for all environment variables.

## Multi-Instance Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_INSTANCES_FILE` | Path to YAML/JSON config file | — |
| `GITLAB_INSTANCES` | Instance list (URL, array, or JSON) | — |

See [Multi-Instance Setup](/guide/multi-instance) for detailed configuration.

**Configuration priority (first match wins):**
1. `GITLAB_INSTANCES_FILE` - Configuration file
2. `GITLAB_INSTANCES` - Environment variable
3. `GITLAB_API_URL` + `GITLAB_TOKEN` - Legacy single-instance

## Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_TOKEN` | [GitLab personal access token](/guide/authentication#pat) | — |
| `GITLAB_API_URL` | GitLab instance URL (legacy single-instance) | `https://gitlab.com` |
| `GITLAB_AUTH_COOKIE_PATH` | Path to auth cookie file (cookie-based auth) | — |

## Project Scope

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_PROJECT_ID` | Default project ID for requests | — |
| `GITLAB_ALLOWED_PROJECT_IDS` | Comma-separated allowed project IDs | — |

When `GITLAB_ALLOWED_PROJECT_IDS` is set:
- **Single value** (e.g., `123`): Acts as default project, restricts to that project only
- **Multiple values** (e.g., `123,456,789`): Restricts access to listed projects, requires explicit project ID

## Access Control

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_READ_ONLY_MODE` | Restrict to read-only operations | `false` |
| `GITLAB_CROSS_REFS` | Include "Related:" cross-references in tool descriptions | `true` |
| `GITLAB_DENIED_TOOLS_REGEX` | Regex to exclude matching tools | — |
| `GITLAB_DENIED_ACTIONS` | Disable specific CQRS actions | — |

## API Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_API_TIMEOUT_MS` | Request timeout in milliseconds | `10000` |
| `GITLAB_API_RETRY_ENABLED` | Enable retry for idempotent ops (GET/HEAD/OPTIONS) | `true` |
| `GITLAB_API_RETRY_MAX_ATTEMPTS` | Max retry attempts | `3` |
| `GITLAB_API_RETRY_BASE_DELAY_MS` | Base delay for exponential backoff | `1000` |
| `GITLAB_API_RETRY_MAX_DELAY_MS` | Max delay cap for backoff | `4000` |
| `SKIP_TLS_VERIFY` | Skip SSL cert verification (dev only) | `false` |

::: warning
`SKIP_TLS_VERIFY=true` bypasses SSL validation. Use only for testing with self-signed certificates.
:::

## Feature Flags

Enable or disable tool groups:

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_LABELS` | Label management tools | `true` |
| `USE_MRS` | Merge request tools | `true` |
| `USE_FILES` | File browsing and management | `true` |
| `USE_VARIABLES` | CI/CD variable tools | `true` |
| `USE_WORKITEMS` | Work items (GraphQL API) | `true` |
| `USE_WEBHOOKS` | Webhook management | `true` |
| `USE_SNIPPETS` | Code snippet tools | `true` |
| `USE_INTEGRATIONS` | Project integration tools | `true` |
| `USE_GITLAB_WIKI` | Wiki page tools | `true` |
| `USE_MILESTONE` | Milestone tools | `true` |
| `USE_PIPELINE` | Pipeline and CI/CD job tools | `true` |
| `USE_RELEASES` | Release management tools | `true` |
| `USE_REFS` | Branch and tag tools | `true` |
| `USE_MEMBERS` | Team member tools | `true` |
| `USE_SEARCH` | Cross-project search | `true` |
| `USE_ITERATIONS` | Iteration planning (sprints) | `true` |

## Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port (enables HTTP mode) | — |
| `HOST` | Server bind address | `0.0.0.0` |

## TLS Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `SSL_CERT_PATH` | PEM certificate file path | — |
| `SSL_KEY_PATH` | PEM private key file path | — |
| `SSL_CA_PATH` | CA certificate chain path | — |
| `SSL_PASSPHRASE` | Private key passphrase | — |
| `TRUST_PROXY` | Express trust proxy setting | — |

See [TLS/HTTPS Configuration](/advanced/tls) for detailed setup guides.

## OAuth Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `OAUTH_ENABLED` | Enable OAuth mode | `false` |
| `OAUTH_SESSION_SECRET` | Session secret (min 32 chars) | — |
| `GITLAB_OAUTH_CLIENT_ID` | GitLab OAuth application ID | — |
| `GITLAB_OAUTH_CLIENT_SECRET` | Client secret (if confidential app) | — |
| `GITLAB_OAUTH_SCOPES` | OAuth scopes | `api,read_user` |
| `OAUTH_TOKEN_TTL` | Token lifetime in seconds | `3600` |
| `OAUTH_REFRESH_TOKEN_TTL` | Refresh token lifetime in seconds | `604800` |
| `OAUTH_DEVICE_POLL_INTERVAL` | Device flow poll interval | `5` |
| `OAUTH_DEVICE_TIMEOUT` | Auth timeout in seconds | `300` |

See [OAuth Authentication](/security/oauth) for setup guide.

## Schema Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_SCHEMA_MODE` | Schema output format (`flat` or `discriminated`) | `flat` |

See [Customization](/advanced/customization) for schema mode details.

## Logging Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `LOG_JSON` | `false` | Output logs as JSON (NDJSON) for log aggregators |
| `LOG_FILTER` | Claude Code filter | JSON array of filter rules to skip access logging |

### Plain Text Mode (default)

Human-readable single-line format suitable for journald, systemd, and console viewing:

```bash
# Default - no configuration needed
gitlab-mcp
```

Output:
```
[12:34:56.789] INFO: 192.168.1.100 abc123.. mygroup/proj - POST /mcp 200 142ms | browse_projects list | GL:200 98ms | items=15
[12:34:57.123] INFO: Session created
```

### JSON Mode

Full JSON output for log aggregation systems (Loki, Elasticsearch, Datadog):

```bash
LOG_JSON=true gitlab-mcp
```

Output:
```json
{"level":30,"time":1737781833989,"name":"gitlab-mcp","msg":"192.168.1.100 abc123.. - - POST /mcp 200 142ms | browse_projects list | GL:200 98ms | items=15","accessLog":{"timestamp":"2026-01-25T04:10:33.989Z","clientIp":"192.168.1.100","session":"abc123..","method":"POST","path":"/mcp","status":200,"durationMs":142,"tool":"browse_projects","action":"list"}}
```

Each line is a valid JSON object (NDJSON format), suitable for ingestion by log aggregators.

**Docker example:**
```bash
docker run -e LOG_JSON=true -e GITLAB_TOKEN=xxx ghcr.io/structured-world/gitlab-mcp:latest
```

**systemd example:**
```ini
[Service]
Environment="LOG_JSON=true"
Environment="GITLAB_TOKEN=xxx"
ExecStart=/usr/bin/node /opt/gitlab-mcp/dist/server.js
```

### Access Log Filtering

Use `LOG_FILTER` to exclude specific requests from access logs. This is useful for reducing noise from health checks, polling, and monitoring tools.

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_FILTER` | Claude Code filter | JSON array of filter rules |

**Filter rule properties** (all optional):

| Property | Type | Description |
|----------|------|-------------|
| `method` | string | HTTP method (exact match, case-insensitive) |
| `path` | string | Request path (exact match, or prefix match if ends with `*`) |
| `userAgent` | string | Substring match in User-Agent header (case-insensitive) |

A request is skipped if **ALL** conditions in a rule match. If a property is omitted, it matches any value.

**Examples:**

```bash
# Skip Claude Code polling (GET / with claude-code user agent)
LOG_FILTER='[{"method":"GET","path":"/","userAgent":"claude-code"}]'

# Skip all HEAD requests (e.g., uptime monitoring)
LOG_FILTER='[{"method":"HEAD","path":"/*"}]'

# Skip requests from monitoring tools
LOG_FILTER='[{"userAgent":"prometheus"},{"userAgent":"datadog"}]'

# Multiple rules combined
LOG_FILTER='[
  {"method":"GET","path":"/","userAgent":"claude-code"},
  {"userAgent":"prometheus"}
]'
```

> **Note:** The `/health` endpoint is registered before access logging middleware and is never logged, so filtering it is unnecessary.

**Default behavior:**

By default, `LOG_FILTER` is set to filter Claude Code polling requests:
```bash
# Default (implicit)
LOG_FILTER='[{"method":"GET","path":"/","userAgent":"claude-code"}]'
```

To log all requests (disable filtering):
```bash
LOG_FILTER='[]'
```

::: info
Filtered requests are still processed normally — only access logging is disabled. Invalid JSON or schema errors log a warning at startup and fall back to logging all requests.
:::
