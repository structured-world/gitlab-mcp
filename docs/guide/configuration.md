# Environment Variables

Complete reference for all environment variables.

## Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `GITLAB_TOKEN` | GitLab personal access token | — |
| `GITLAB_API_URL` | GitLab instance URL | `https://gitlab.com` |
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
| `USE_GITLAB_WIKI` | Wiki page tools | `false` |
| `USE_MILESTONE` | Milestone tools | `false` |
| `USE_PIPELINE` | Pipeline and CI/CD job tools | `false` |

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
