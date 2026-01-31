---
title: "CLI: list-tools"
description: "List available GitLab MCP tools with filtering by entity, tier info, and export capabilities"
head:
  - - meta
    - name: keywords
      content: gitlab mcp tools, mcp tool list, gitlab api tools, gitlab tier badges, mcp tool documentation, gitlab mcp export
---

# gitlab-mcp list-tools

Browse and export available GitLab MCP tools, their descriptions, parameters, and tier requirements.

## Usage

```bash
# List all tools with descriptions and tier badges
yarn list-tools

# Full parameter details
yarn list-tools --detail

# Simple format (names only)
yarn list-tools --simple

# Filter by entity
yarn list-tools --entity workitems
yarn list-tools --entity "merge requests"

# Get info for a specific tool
yarn list-tools --tool browse_merge_requests

# JSON output for automation
yarn list-tools --json

# Show environment configuration
yarn list-tools --env
```

## Generate Documentation

```bash
# Generate complete markdown documentation
yarn list-tools --export > docs/TOOLS.md

# Include table of contents
yarn list-tools --export --toc > docs/TOOLS.md

# Compact format (no example JSON)
yarn list-tools --export --no-examples > docs/TOOLS.md
```

The `--export` mode generates:
- Actions table — Available actions from CQRS schemas
- Parameters table — Types, required status, and action hints
- Example JSON — Sample request for each tool
- Tier badges — GitLab tier requirements
- Version info — Package version and generation timestamp

## Environment Filtering

The CLI respects runtime configuration:

```bash
# Show only read-only tools
GITLAB_READ_ONLY_MODE=true yarn list-tools

# Hide work items tools
USE_WORKITEMS=false yarn list-tools

# Apply regex filter
GITLAB_DENIED_TOOLS_REGEX="wiki|milestone" yarn list-tools
```

## Tier Badges

Tools display their GitLab tier requirement:

| Badge | Tier |
|-------|------|
| Free | Available in all GitLab tiers |
| Premium | Requires GitLab Premium or higher |
| Ultimate | Requires GitLab Ultimate |

## Examples

```bash
# Find merge request tools
yarn list-tools --entity mrs

# Check parameters for creating a work item
yarn list-tools --tool manage_work_item

# Export tool list for documentation
yarn list-tools --json > tools.json

# Count read-only tools
GITLAB_READ_ONLY_MODE=true yarn list-tools --simple | wc -l
```
