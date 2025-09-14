# GitLab MCP Server Dockerfile
# Multi-stage build for optimal image size and security

# ============================================================================
# BUILD STAGE
# ============================================================================
FROM node:22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Enable Corepack for Yarn 4
RUN corepack enable

# Set working directory
WORKDIR /app

# Copy package management files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Install dependencies with cache mount
RUN --mount=type=cache,target=/app/.yarn/cache \
    yarn install --immutable

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Remove dev dependencies and rebuild for production
RUN --mount=type=cache,target=/app/.yarn/cache \
    yarn workspaces focus --production

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

# Copy built application and dependencies from builder
COPY --from=builder --chown=gitlab-mcp:gitlab-mcp /app/dist ./dist
COPY --from=builder --chown=gitlab-mcp:gitlab-mcp /app/node_modules ./node_modules
COPY --from=builder --chown=gitlab-mcp:gitlab-mcp /app/package.json ./package.json

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

# Performance and resource limits
ENV NODE_OPTIONS="--max-old-space-size=512"

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

# Set entrypoint
ENTRYPOINT ["node", "dist/main.js"]

# Default command arguments (can be overridden)
CMD ["sse"]

# ============================================================================
# LABELS AND METADATA
# ============================================================================
LABEL org.opencontainers.image.title="GitLab MCP Server"
LABEL org.opencontainers.image.description="Model Context Protocol server for GitLab API integration"
LABEL org.opencontainers.image.vendor="Structured World"
LABEL org.opencontainers.image.authors="Dmitry Prudnikov <mail@polaz.com>"
LABEL org.opencontainers.image.url="https://github.com/structured-world/mcp-gitlab"
LABEL org.opencontainers.image.documentation="https://github.com/structured-world/mcp-gitlab/blob/main/README.md"
LABEL org.opencontainers.image.source="https://github.com/structured-world/mcp-gitlab"
LABEL org.opencontainers.image.licenses="MIT"