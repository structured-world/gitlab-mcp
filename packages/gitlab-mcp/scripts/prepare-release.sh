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

# Get dynamic tool counts from the built registry.
# Design: stderr is redirected to suppress noisy Node.js errors (module resolution, etc.)
# so stdout stays clean for release output. Counts derived from dist/ FAIL the
# release if they can't be computed — publishing stale hardcoded metrics silently
# is worse than aborting and rebuilding dist. ENTITY_COUNT reads the source tree
# (not dist), so it keeps a warn+fallback.
TOOL_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");console.log(r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered().length)' 2>/dev/null)
if [[ -z "$TOOL_COUNT" ]]; then
  echo "ERROR: Failed to compute TOOL_COUNT from dist/ registry; rebuild and re-run" >&2
  exit 1
fi

ENTITY_COUNT=$(node -e 'const fs=require("fs"),p=require("path");const d=p.join(process.cwd(),"src","entities");console.log(fs.readdirSync(d,{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(p.join(d,e.name,"registry.ts"))).length)' 2>/dev/null)
if [[ -z "$ENTITY_COUNT" ]]; then ENTITY_COUNT=18; echo "WARNING: Using fallback ENTITY_COUNT=$ENTITY_COUNT" >&2; fi

# Read-only tools: browse_* (queries) + manage_context (read-only despite manage_ prefix)
# Same pattern used in inject-tool-refs.ts for consistency
READONLY_TOOL_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");const t=r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered();console.log(t.filter(x=>x.name.startsWith("browse_")||x.name==="manage_context").length)' 2>/dev/null)
if [[ -z "$READONLY_TOOL_COUNT" ]]; then
  echo "ERROR: Failed to compute READONLY_TOOL_COUNT from dist/ registry; rebuild and re-run" >&2
  exit 1
fi

# Total typed actions across all CQRS tools (discriminated-union oneOf branches
# with an action const, or a flat action enum). Mirrors extractActions() in
# src/cli/inject-tool-refs.ts so README and docs report the same operation count.
ACTION_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");const t=r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered();let n=0;for(const x of t){const s=x.inputSchema;if(Array.isArray(s.oneOf)){for(const b of s.oneOf){if(b.properties&&b.properties.action&&typeof b.properties.action.const==="string")n++;}}else if(s.properties&&s.properties.action&&Array.isArray(s.properties.action.enum)){n+=s.properties.action.enum.filter(v=>typeof v==="string").length;}}console.log(n)' 2>/dev/null)
if [[ -z "$ACTION_COUNT" ]]; then
  echo "ERROR: Failed to compute ACTION_COUNT from dist/ registry; rebuild and re-run" >&2
  exit 1
fi

echo "prepare-release: v${VERSION}, ${TOOL_COUNT} tools (${READONLY_TOOL_COUNT} read-only, ${ACTION_COUNT} actions), ${ENTITY_COUNT} entities"

# Update server.json: version + description
# Note: set -e ensures script exits on jq failure; leftover server.tmp is benign
# (gitignored, cleaned by next successful run, doesn't affect release)
jq --arg v "$VERSION" --arg tc "$TOOL_COUNT" \
  '.version = $v | .packages[0].version = $v | .description = "GitLab MCP server with " + $tc + " tools for projects, MRs, pipelines, and more"' \
  server.json > server.tmp && mv server.tmp server.json

# Generate README.md from the template for each location it ships to. __REPO_BASE__
# is substituted with the path from that README's directory to the repo root, so the
# repo-relative links (LICENSE, CONTRIBUTING, assets) resolve from every location:
#   packages/gitlab-mcp/README.md (npm package page) -> base ../..
#   <repo root>/README.md          (GitHub repo page) -> base .
if [[ ! -f "README.md.in" ]]; then
  echo "ERROR: README.md.in not found" >&2
  exit 1
fi
render_readme() {
  # $1 = output path, $2 = relative path from that README's directory to the repo root
  sed -e "s/__TOOL_COUNT__/${TOOL_COUNT}/g" \
      -e "s/__ACTION_COUNT__/${ACTION_COUNT}/g" \
      -e "s/__ENTITY_COUNT__/${ENTITY_COUNT}/g" \
      -e "s/__READONLY_TOOL_COUNT__/${READONLY_TOOL_COUNT}/g" \
      -e "s/__VERSION__/${VERSION}/g" \
      -e "s|__REPO_BASE__|$2|g" \
      README.md.in > "$1"
}
render_readme README.md ../..
render_readme ../../README.md .

# Update MCP manifest tools list in package.json
# Uses the list-tools CLI to get full tool definitions and transforms them for manifest
echo "Updating MCP manifest in package.json..."
node -e '
const r = require("./dist/src/registry-manager.js");
const tools = r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered();
console.log(JSON.stringify(tools.map(t => ({
  name: t.name,
  description: t.description,
  tier: t.tier || "free"
}))))
' 2>/dev/null | node scripts/update-mcp-manifest.js

# Write version file for CI
echo "$VERSION" > .semantic-release-version
