#!/usr/bin/env bash
# IMPORTANT: This script must be executable (chmod +x) for semantic-release to invoke it.
# Git preserves executable bit in commits, so no runtime chmod check needed — the bit
# is set once at initial commit and preserved across clones/checkouts.
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
# Design: stderr is redirected to suppress noisy Node.js errors (module resolution, etc.)
# If the node command fails, result is empty → triggers fallback with WARNING to stderr.
# This ensures clean stdout for release output while surfacing fallback usage in CI logs.
TOOL_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");console.log(r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered().length)' 2>/dev/null)
if [ -z "$TOOL_COUNT" ]; then TOOL_COUNT=44; echo "WARNING: Using fallback TOOL_COUNT=$TOOL_COUNT" >&2; fi

ENTITY_COUNT=$(node -e 'const fs=require("fs"),p=require("path");const d=p.join(process.cwd(),"src","entities");console.log(fs.readdirSync(d,{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(p.join(d,e.name,"registry.ts"))).length)' 2>/dev/null)
if [ -z "$ENTITY_COUNT" ]; then ENTITY_COUNT=18; echo "WARNING: Using fallback ENTITY_COUNT=$ENTITY_COUNT" >&2; fi

# Read-only tools: browse_* (queries) + manage_context (read-only despite manage_ prefix)
# Same pattern used in inject-tool-refs.ts for consistency
READONLY_TOOL_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");const t=r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered();console.log(t.filter(x=>x.name.startsWith("browse_")||x.name==="manage_context").length)' 2>/dev/null)
if [ -z "$READONLY_TOOL_COUNT" ]; then READONLY_TOOL_COUNT=24; echo "WARNING: Using fallback READONLY_TOOL_COUNT=$READONLY_TOOL_COUNT" >&2; fi

echo "prepare-release: v${VERSION}, ${TOOL_COUNT} tools (${READONLY_TOOL_COUNT} read-only), ${ENTITY_COUNT} entities"

# Update server.json: version + description
# Note: set -e ensures script exits on jq failure; leftover server.tmp is benign
# (gitignored, cleaned by next successful run, doesn't affect release)
jq --arg v "$VERSION" --arg tc "$TOOL_COUNT" \
  '.version = $v | .packages[0].version = $v | .description = "GitLab MCP server with " + $tc + " tools for projects, MRs, pipelines, and more"' \
  server.json > server.tmp && mv server.tmp server.json

# Generate README.md from template (replaces fragile regex patterns)
if [ ! -f "README.md.in" ]; then
  echo "ERROR: README.md.in not found" >&2
  exit 1
fi
sed -e "s/__TOOL_COUNT__/${TOOL_COUNT}/g" \
    -e "s/__ENTITY_COUNT__/${ENTITY_COUNT}/g" \
    -e "s/__READONLY_TOOL_COUNT__/${READONLY_TOOL_COUNT}/g" \
    -e "s/__VERSION__/${VERSION}/g" \
    README.md.in > README.md

# Write version file for CI
echo "$VERSION" > .semantic-release-version
