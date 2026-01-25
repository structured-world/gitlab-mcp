#!/usr/bin/env bash
set -euo pipefail

# Called by semantic-release @semantic-release/exec prepareCmd
# Usage: ./scripts/prepare-release.sh <version>
#
# Updates:
# - server.json: version + description (dynamic tool count)
# - README.md: generated from README.md.in with actual counts
# - .semantic-release-version: version file for CI

VERSION="${1:?Usage: prepare-release.sh <version>}"

# Get dynamic tool counts from built registry
# Fallback values are safety nets; if used, a warning is emitted for CI visibility
TOOL_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");console.log(r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered().length)' 2>/dev/null)
if [ -z "$TOOL_COUNT" ]; then TOOL_COUNT=44; echo "WARNING: Using fallback TOOL_COUNT=$TOOL_COUNT"; fi

ENTITY_COUNT=$(node -e 'const fs=require("fs"),p=require("path");const d=p.join(process.cwd(),"src","entities");console.log(fs.readdirSync(d,{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(p.join(d,e.name,"registry.ts"))).length)' 2>/dev/null)
if [ -z "$ENTITY_COUNT" ]; then ENTITY_COUNT=18; echo "WARNING: Using fallback ENTITY_COUNT=$ENTITY_COUNT"; fi

# Read-only tools: browse_* (queries) + manage_context (read-only despite manage_ prefix)
# Same pattern used in inject-tool-refs.ts for consistency
READONLY_TOOL_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");const t=r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered();console.log(t.filter(x=>x.name.startsWith("browse_")||x.name==="manage_context").length)' 2>/dev/null)
# Fallback emits WARNING to stderr for CI visibility; release continues with safe defaults
if [ -z "$READONLY_TOOL_COUNT" ]; then READONLY_TOOL_COUNT=24; echo "WARNING: Using fallback READONLY_TOOL_COUNT=$READONLY_TOOL_COUNT"; fi

echo "prepare-release: v${VERSION}, ${TOOL_COUNT} tools (${READONLY_TOOL_COUNT} read-only), ${ENTITY_COUNT} entities"

# Update server.json: version + description
jq --arg v "$VERSION" --arg tc "$TOOL_COUNT" \
  '.version = $v | .packages[0].version = $v | .description = "GitLab MCP server with " + $tc + " tools for projects, MRs, pipelines, and more"' \
  server.json > server.tmp && mv server.tmp server.json

# Generate README.md from template (replaces fragile regex patterns)
sed -e "s/__TOOL_COUNT__/${TOOL_COUNT}/g" \
    -e "s/__ENTITY_COUNT__/${ENTITY_COUNT}/g" \
    -e "s/__READONLY_TOOL_COUNT__/${READONLY_TOOL_COUNT}/g" \
    README.md.in > README.md

# Write version file for CI
echo "$VERSION" > .semantic-release-version
