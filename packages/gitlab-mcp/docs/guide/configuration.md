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

The restriction is enforced before tool execution. Project IDs, full paths and
URL-encoded paths are resolved to the same GitLab project. Account settings and
the chat's working scope may narrow this list; selecting `everywhere` cannot widen
it. Targetless listings and searches use only permitted projects. Group operations
that cannot be confined to those projects are refused. The scope picker offers
only allowed projects. Explicit targets take precedence over `GITLAB_PROJECT_ID`;
defaults are authorized by the same check as explicit targets.

Global work item, container repository, vulnerability and todo IDs require ownership
evidence from the connected GitLab instance, even when a permitted project is also
supplied. Relationship targets are checked too. Timelog and suggestion operations
require matching project metadata, with bounded verification; missing evidence,
excessive pagination or an expired request fails closed. Older GitLab versions that
do not expose suggestion ownership metadata cannot apply suggestions with an
allowlist enabled. Without an allowlist, these checks add no ownership requests.

This is a server-side restriction on tool arguments and results, not a replacement
for GitLab token permissions. Use a project access token when GitLab itself must
enforce the project boundary. The caller's GitLab token remains authoritative for
all requests and project identity lookups.

Runner lists retain only project runners whose complete
set of associated projects is allowed. The upstream cursor is preserved, so a
filtered page may be empty while a later page contains allowed runners.

Operations by `runner_id` require the same complete association check before
reading details, listing jobs, changing settings, deleting, or rotating a token.
Hidden associations, missing ownership evidence, or more than 100 associated
projects fail closed. Jobs are additionally filtered by their own project, including
historical jobs from before a runner was reassigned. Group and instance runners
cannot be confined to this project allowlist; their registration and ID-based
operations are refused. Project runner registration checks its project first.
Without an allowlist, runner tools make no additional ownership requests.

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
| `GITLAB_API_CONNECT_TIMEOUT_MS` | TCP connect timeout in ms | `2000` |
| `GITLAB_API_HEADERS_TIMEOUT_MS` | Response headers timeout in ms | `10000` |
| `GITLAB_API_BODY_TIMEOUT_MS` | Response body timeout in ms | `30000` |
| `GITLAB_TOOL_TIMEOUT_MS` | Total tool execution timeout in ms | `120000` |
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
| `USE_CI_TOKENS` | CI access credential tools: job token scope/allowlist and deploy keys | `true` |
| `USE_ENVIRONMENTS` | Environments and deployments | `true` |
| `USE_RUNNERS` | CI runner management | `true` |
| `USE_REGISTRY` | Container registry repositories and tags | `true` |
| `USE_ACCESS_TOKENS` | Project/group/personal access token management | `true` |
| `USE_AUDIT_EVENTS` | Audit events (Premium+) | `true` |
| `USE_VULNERABILITIES` | Vulnerability management (Ultimate) | `true` |

## Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port (enables HTTP mode) | — |
| `HOST` | Server bind address | `127.0.0.1` |
| `MCP_REQUEST_BODY_LIMIT` | Maximum JSON body size for MCP HTTP POST requests, using Express size syntax (`512kb`, `10mb`, or a byte count) | `10mb` (10 MiB) |

The body limit applies to `POST /mcp`, `POST /` and legacy SSE `POST /messages`.
Use an integer byte count or an explicit unit (`b`, `kb`, `mb`, `gb`, `tb`, `pb`);
larger units also accept decimal values. Invalid values stop startup.
It counts serialized JSON bytes, including escaping and the JSON-RPC envelope;
for compressed requests, it counts bytes after decompression. Requests above it
receive HTTP 413 with a JSON-RPC `-32600` error naming the limit and setting.
Rate limiting and OAuth authentication run before parsing; legacy SSE messages
also require an existing session owned by the authenticated account. OAuth
registration and token endpoints retain their own parsers and limits. The setting
does not affect stdio or change GitLab's own limits for notes, descriptions or files.

A reverse proxy has an independent request body limit. Raise it too when needed,
for example nginx's `client_max_body_size`, otherwise the proxy may reject a request
before it reaches the MCP server.

> **Security note:** The default `127.0.0.1` binds only to localhost, preventing network access to the server and your `GITLAB_TOKEN`. If you run inside Docker, set `HOST=0.0.0.0` explicitly — containers need it for port mapping to work. The Dockerfile and docker-compose examples already include this setting.

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
| `OAUTH_ISSUER` | Public URL clients connect to; required in OAuth mode (https, or http for localhost) | — |
| `OAUTH_SESSION_SECRET` | Session secret (min 32 chars) | — |
| `OAUTH_CLIENT_ID` | GitLab OAuth application ID | — |
| `OAUTH_CLIENT_SECRET` | Client secret (if confidential app) | — |
| `OAUTH_SCOPES` | OAuth scopes | `api,read_user` |
| `OAUTH_TOKEN_TTL` | Token lifetime in seconds | `3600` |
| `OAUTH_REFRESH_TOKEN_TTL` | Refresh token lifetime in seconds | `604800` |
| `OAUTH_DEVICE_POLL_INTERVAL` | Minimum device flow poll interval in seconds; GitLab's interval and `slow_down` raise it | `5` |
| `OAUTH_DEVICE_TIMEOUT` | Maximum device flow lifetime in seconds; GitLab's `expires_in` can shorten it | `300` |

See [OAuth Authentication](/security/oauth) for setup guide.

## Session Storage

OAuth sessions can be kept in memory, in a file, or in PostgreSQL.

| Variable | Description | Default |
|----------|-------------|---------|
| `OAUTH_STORAGE_TYPE` | `memory`, `file`, or `postgresql` | `memory` |
| `OAUTH_STORAGE_FILE_PATH` | Path for `file` storage | `./data/oauth-sessions.json` |
| `OAUTH_STORAGE_POSTGRESQL_URL` | PostgreSQL connection string (or `DATABASE_URL`) | — |

- **`memory`** (default) — fastest, zero footprint; sessions are lost on restart
  and not shared between replicas.
- **`file`** — single-instance persistence across restarts.
- **`postgresql`** — persistent, multi-instance. Requires the optional
  `@structured-world/gitlab-mcp-db` package (or the `gitlab-mcp-db` Docker image),
  which carries the Prisma-based backend. The default `gitlab-mcp` package/image
  does not include PostgreSQL — selecting `postgresql` without the db package
  fails with a clear error telling you to install it.

See [Docker + PostgreSQL](/deployment/docker-postgres) for a full deployment.

## Schema Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_SCHEMA_MODE` | Schema output format (`flat`, `discriminated`, or per-session `auto`) | `flat` |

See [Customization](/advanced/customization) for schema mode details.

## Logging Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `LOG_JSON` | `false` | Output logs as JSON (NDJSON) for log aggregators |
| `LOG_FORMAT` | `%msg` | Which fields appear in plain-text logs: `%time`, `%level`, `%name`. Tokens toggle field visibility only; the line always renders in pino-pretty's fixed `[time] LEVEL (name): msg` order, and the message itself is always included regardless of `%msg` (e.g. `[%time] %level (%name): %msg` enables all fields) |
| `LOG_DESTINATION` | auto | `stdout` or `stderr`. HTTP mode only; see [Log Destinations](#log-destinations-stdout-vs-stderr) |
| `LOG_FILTER` | Claude Code filter | JSON array of filter rules to skip access logging |

### Log Destinations (stdout vs stderr)

Where log lines are written depends on the transport mode:

| Mode | Plain text (default) | `LOG_JSON=true` |
|------|----------------------|-----------------|
| stdio (no `PORT`) | stderr (always) | stderr (always) |
| HTTP (`PORT` set) | stderr | stdout |

**In stdio mode all logs always go to stderr.** stdout is reserved for MCP JSON-RPC
protocol frames ([MCP spec](https://modelcontextprotocol.io/specification/basic/transports#stdio)),
so any log line on stdout would corrupt the client connection. `LOG_DESTINATION` is
ignored in stdio mode.

In HTTP mode the defaults follow the container convention: JSON logs go to stdout for
log-driver ingestion, human-readable logs go to stderr. Set `LOG_DESTINATION=stdout`
or `LOG_DESTINATION=stderr` to override. Docker's `docker logs` and journald capture
both streams either way.

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
