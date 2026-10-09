# GitLab MCP Server + PostgreSQL backend (gitlab-mcp-db)
#
# Layered ON TOP of the core gitlab-mcp image so the core build/runtime layers
# are reused from cache; this image only adds the optional PostgreSQL backend
# (@structured-world/gitlab-mcp-db) and its Prisma client.
#
# Build context is the REPO ROOT (monorepo), with the core image as a build-arg:
#   docker build -f packages/gitlab-mcp-db/Dockerfile \
#     --build-arg CORE_IMAGE=gitlab-mcp:latest -t gitlab-mcp-db .

# Core image to layer on. The default keeps the Dockerfile valid and buildable
# standalone; CI and the release pipeline always override it with the exact,
# version-pinned core image via --build-arg (e.g.
# ghcr.io/structured-world/gitlab-mcp:8.0.0) so published builds stay reproducible.
ARG CORE_IMAGE=ghcr.io/structured-world/gitlab-mcp:latest

# ============================================================================
# DB BUILD STAGE - Build the db package and resolve its production deps
# ============================================================================
FROM node:22-alpine AS db-builder

# Enable Corepack and prepare Yarn
RUN corepack enable && corepack prepare yarn@4.13.0 --activate

# Set working directory
WORKDIR /app

# Copy workspace manifests for a cache-friendly install
COPY package.json yarn.lock .yarnrc.yml nx.json ./
COPY .yarn/releases/ .yarn/releases/
COPY packages/gitlab-mcp/package.json ./packages/gitlab-mcp/package.json
COPY packages/gitlab-mcp-db/package.json ./packages/gitlab-mcp-db/package.json

# Install all dependencies (db needs core for type-only contract during build)
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    --mount=type=cache,target=/app/.yarn/cache \
    yarn install --immutable

# Copy sources: core (for the contract types) and the db package
COPY packages/gitlab-mcp ./packages/gitlab-mcp
COPY packages/gitlab-mcp-db ./packages/gitlab-mcp-db

# Core must be built first so the db package can resolve its type-only contract
RUN yarn workspace @structured-world/gitlab-mcp build
# Build the db package (runs prisma generate + tsc)
RUN yarn workspace @structured-world/gitlab-mcp-db build

# Collect only what the backend and `prisma migrate` load (Prisma client runtime,
# pg driver adapter, Prisma CLI with the native schema engine of this platform),
# without Studio, `prisma dev` or the query compilers of other databases
RUN node packages/gitlab-mcp-db/scripts/runtime-node-modules.mjs /app/db-runtime/node_modules

# ============================================================================
# RUNTIME STAGE - Core image + the db package as a resolvable node module
# ============================================================================
FROM ${CORE_IMAGE}

# Root needed to add files under node_modules; dropped back to the app user after
USER root

# Install the db package as a real node module so core's lazy
# require('@structured-world/gitlab-mcp-db') resolves at runtime. Its generated
# Prisma client lives inside the package (custom output dir).
COPY --from=db-builder --chown=gitlab-mcp:gitlab-mcp /app/packages/gitlab-mcp-db/dist \
    /app/node_modules/@structured-world/gitlab-mcp-db/dist
COPY --from=db-builder --chown=gitlab-mcp:gitlab-mcp /app/packages/gitlab-mcp-db/generated \
    /app/node_modules/@structured-world/gitlab-mcp-db/generated
COPY --from=db-builder --chown=gitlab-mcp:gitlab-mcp /app/packages/gitlab-mcp-db/package.json \
    /app/node_modules/@structured-world/gitlab-mcp-db/package.json

# Schema, migrations and Prisma config for `prisma migrate deploy` inside the image
COPY --from=db-builder --chown=gitlab-mcp:gitlab-mcp /app/packages/gitlab-mcp-db/prisma \
    /app/node_modules/@structured-world/gitlab-mcp-db/prisma
COPY --from=db-builder --chown=gitlab-mcp:gitlab-mcp /app/packages/gitlab-mcp-db/prisma.config.ts \
    /app/node_modules/@structured-world/gitlab-mcp-db/prisma.config.ts

# Runtime dependencies go into the package's own node_modules, so they resolve
# from the backend and the generated client without replacing any version the
# core image already ships
COPY --from=db-builder --chown=gitlab-mcp:gitlab-mcp /app/db-runtime/node_modules \
    /app/node_modules/@structured-world/gitlab-mcp-db/node_modules

# PostgreSQL storage is opt-in at runtime via OAUTH_STORAGE_TYPE=postgresql
ENV OAUTH_STORAGE_TYPE=""
# Migrations from the image make no update-check calls to Prisma's servers
ENV CHECKPOINT_DISABLE=1

# Drop back to the non-root app user
USER gitlab-mcp

LABEL org.opencontainers.image.title="GitLab MCP Server (with PostgreSQL backend)"
LABEL org.opencontainers.image.description="GitLab MCP server with the optional PostgreSQL/Prisma OAuth-storage backend"
