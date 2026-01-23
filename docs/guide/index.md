# Introduction

GitLab MCP Server is a [Model Context Protocol](https://modelcontextprotocol.io/) server that provides AI agents with access to the GitLab API.

## Features

- **47 tools** across 17 entity types covering the full GitLab API
- **CQRS pattern** — `browse_*` for read operations, `manage_*` for writes
- **Multiple transports** — stdio, SSE, and StreamableHTTP
- **OAuth 2.1** — Per-user authentication for teams via Claude Custom Connector
- **Read-only mode** — Safe operation for production environments
- **Auto-discovery** — Detects GitLab config from git remotes
- **Fine-grained control** — Enable/disable tool groups, filter actions, customize descriptions
- **Tier detection** — Automatically enables features based on your GitLab tier

## Requirements

- **Node.js** >= 24.0.0 (required for native fetch with Undici dispatcher pattern)
- **GitLab** — Compatible with GitLab.com and self-hosted instances

## Architecture

The server uses a **CQRS (Command Query Responsibility Segregation)** pattern:

| Pattern | Prefix | Purpose | Example |
|---------|--------|---------|---------|
| Query | `browse_*` | Read-only operations | `browse_merge_requests` |
| Command | `manage_*` | Write operations | `manage_merge_request` |

Each tool accepts an `action` parameter that selects the specific operation. This consolidates what would be many individual tools into a manageable set optimized for AI context windows.

## Next Steps

- [Quick Start](/guide/quick-start) — Get running in under a minute
- [Installation](/guide/installation/npm) — Detailed setup for your platform
- [Configuration](/guide/configuration) — Environment variables and options
- [Tool Reference](/tools/) — Complete list of available tools
