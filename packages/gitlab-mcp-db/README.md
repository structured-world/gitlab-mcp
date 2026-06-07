# @structured-world/gitlab-mcp-db

[![npm version](https://img.shields.io/npm/v/@structured-world/gitlab-mcp-db)](https://www.npmjs.com/package/@structured-world/gitlab-mcp-db) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/structured-world/gitlab-mcp/blob/main/LICENSE) [![Docs](https://img.shields.io/badge/docs-gitlab--mcp.sw.foundation-brightgreen)](https://gitlab-mcp.sw.foundation)

Optional **PostgreSQL/Prisma OAuth-session storage backend** for
[`@structured-world/gitlab-mcp`](https://www.npmjs.com/package/@structured-world/gitlab-mcp).

The core server uses in-memory or file session storage by default and carries no
database dependency. Install this package to persist OAuth sessions in PostgreSQL —
required when you run multiple server replicas behind a load balancer and need sessions
shared across them.

## Usage

Install it alongside the core server and select the PostgreSQL backend at runtime:

```bash
npm install @structured-world/gitlab-mcp @structured-world/gitlab-mcp-db
```

```bash
OAUTH_ENABLED=true
OAUTH_STORAGE_TYPE=postgresql
DATABASE_URL=postgresql://user:password@host:5432/gitlab_mcp
```

The core server lazily loads this package only when `OAUTH_STORAGE_TYPE=postgresql`, so
it stays out of the default footprint. Prisma migrations run automatically on startup.

### Docker

A prebuilt image bundles the core server with this backend:

```bash
docker run -d --name gitlab-mcp \
  -e OAUTH_ENABLED=true \
  -e OAUTH_STORAGE_TYPE=postgresql \
  -e DATABASE_URL="postgresql://user:password@host:5432/gitlab_mcp" \
  -e OAUTH_SESSION_SECRET="$(openssl rand -hex 32)" \
  -e OAUTH_CLIENT_ID=your_oauth_app_id \
  -p 3333:3333 \
  ghcr.io/structured-world/gitlab-mcp-db:latest
```

See the [Docker + PostgreSQL guide](https://gitlab-mcp.sw.foundation/deployment/docker-postgres)
for the full deployment, environment reference, and schema details.

## License

[Apache-2.0](https://github.com/structured-world/gitlab-mcp/blob/main/LICENSE)
