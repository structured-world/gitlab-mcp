# GitLab MCP Server Dockerfile (core, no Prisma)
# Multi-stage build for optimal image size and security.
#
# Build context is the REPO ROOT (monorepo), e.g.:
#   docker build -f packages/gitlab-mcp/Dockerfile -t gitlab-mcp .
# The optional PostgreSQL backend lives in @structured-world/gitlab-mcp-db and
# is layered on top by packages/gitlab-mcp-db/Dockerfile.

# ============================================================================
# DEPENDENCIES STAGE - Install all dependencies (workspace-aware)
# ============================================================================
FROM node:22-alpine AS dependencies

# Enable Corepack and prepare Yarn
RUN corepack enable && corepack prepare yarn@4.13.0 --activate

# Set working directory
WORKDIR /app

# Copy only the workspace manifests for better caching: the root manifests plus
# each package's package.json, so the install layer is reused unless deps change.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases/ .yarn/releases/
COPY packages/gitlab-mcp/package.json ./packages/gitlab-mcp/package.json
COPY packages/gitlab-mcp-db/package.json ./packages/gitlab-mcp-db/package.json

# Install ALL dependencies (including dev) for building
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    --mount=type=cache,target=/app/.yarn/cache \
    yarn install --immutable

# ============================================================================
# BUILD STAGE - Build the core package only
# ============================================================================
FROM node:22-alpine AS builder

# Enable Corepack and prepare Yarn (same version)
RUN corepack enable && corepack prepare yarn@4.13.0 --activate

# Set working directory
WORKDIR /app

# Copy dependencies and Yarn setup from previous stage
COPY --from=dependencies /app/node_modules ./node_modules
# Copy .yarn directory to avoid re-downloading Yarn
COPY --from=dependencies /app/.yarn ./.yarn

# Copy root workspace config and the core package source
COPY package.json yarn.lock .yarnrc.yml nx.json ./
COPY packages/gitlab-mcp ./packages/gitlab-mcp

# Build the application (core only — no Prisma generation here)
RUN yarn workspace @structured-world/gitlab-mcp build

# ============================================================================
# PRODUCTION DEPENDENCIES STAGE - Install only production dependencies
# ============================================================================
FROM node:22-alpine AS production-deps

# Enable Corepack and prepare Yarn (same version)
RUN corepack enable && corepack prepare yarn@4.13.0 --activate

# Set working directory
WORKDIR /app

# Copy workspace manifests and Yarn setup
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/gitlab-mcp/package.json ./packages/gitlab-mcp/package.json
COPY packages/gitlab-mcp-db/package.json ./packages/gitlab-mcp-db/package.json
# Copy .yarn directory from dependencies stage to avoid re-downloading
COPY --from=dependencies /app/.yarn ./.yarn

# Install only production dependencies for the core workspace
ENV NODE_ENV=production
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    --mount=type=cache,target=/app/.yarn/cache \
    yarn workspaces focus @structured-world/gitlab-mcp --production

# ============================================================================
# RUNTIME STAGE
# ============================================================================
FROM node:22-alpine AS runtime

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    && update-ca-certificates

# Create non-root user for security
RUN addgroup -g 1001 -S gitlab-mcp && \
    adduser -S gitlab-mcp -u 1001 -G gitlab-mcp

# Set working directory
WORKDIR /app

# Copy built core application from builder
COPY --from=builder --chown=gitlab-mcp:gitlab-mcp /app/packages/gitlab-mcp/dist ./dist

# Copy production dependencies from production-deps stage (hoisted to root)
COPY --from=production-deps --chown=gitlab-mcp:gitlab-mcp /app/node_modules ./node_modules

# Copy package.json for reference
COPY --from=builder --chown=gitlab-mcp:gitlab-mcp /app/packages/gitlab-mcp/package.json ./package.json

# ============================================================================
# ENVIRONMENT CONFIGURATION
# ============================================================================

# Core GitLab connection settings (required)
ENV GITLAB_TOKEN=""
ENV GITLAB_API_URL=""

# Optional GitLab connection settings
ENV GITLAB_PROJECT_ID=""
ENV GITLAB_GROUP_PATH=""

# Server configuration
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV HOST=0.0.0.0
ENV PORT=3000

# Transport mode configuration (default: HTTP streamable)
ENV STREAMABLE_HTTP=true
ENV SSE=false

# Feature flags for GitLab tiers
ENV USE_WORKITEMS=true
ENV USE_MILESTONE=true
ENV USE_PIPELINE=true
ENV USE_GITLAB_WIKI=true

# Security and access control
ENV GITLAB_READ_ONLY_MODE=false
ENV GITLAB_DENIED_TOOLS_REGEX=""

# Network and proxy settings
ENV HTTP_PROXY=""
ENV HTTPS_PROXY=""
ENV NO_PROXY=""

# Performance and resource limits with ESM support
ENV NODE_OPTIONS="--max-old-space-size=512 --experimental-specifier-resolution=node --no-warnings"

# Health check endpoint
ENV HEALTH_CHECK_ENABLED=true

# ============================================================================
# RUNTIME CONFIGURATION
# ============================================================================

# Switch to non-root user
USER gitlab-mcp

# Expose default port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); const options = { host: 'localhost', port: process.env.PORT || 3000, path: '/health', timeout: 2000 }; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();" || exit 1

# Set entrypoint (build output keeps the src/ layout under dist/)
ENTRYPOINT ["node", "dist/src/main.js"]

# Default command arguments (can be overridden)
CMD ["sse"]

# ============================================================================
# LABELS AND METADATA
# ============================================================================
LABEL org.opencontainers.image.title="GitLab MCP Server"
LABEL org.opencontainers.image.description="Advanced GitLab MCP server"
LABEL org.opencontainers.image.vendor="sw.foundation"
LABEL org.opencontainers.image.authors="Dmitry Prudnikov <mail@polaz.com>"
LABEL org.opencontainers.image.url="https://github.com/structured-world/gitlab-mcp"
LABEL org.opencontainers.image.documentation="https://github.com/structured-world/gitlab-mcp/blob/main/README.md"
LABEL org.opencontainers.image.source="https://github.com/structured-world/gitlab-mcp"
LABEL org.opencontainers.image.licenses="MIT"
