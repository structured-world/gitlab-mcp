#!/usr/bin/env bash
set -euo pipefail

# Called by semantic-release @semantic-release/exec prepareCmd
# Usage: ./scripts/prepare-release.sh <version>
#
# Updates:
# - server.json: version + description (dynamic tool count)
# - README.md: tool count references
# - .semantic-release-version: version file for CI

VERSION="${1:?Usage: prepare-release.sh <version>}"

# Get dynamic tool counts from built registry
TOOL_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");console.log(r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered().length)' 2>/dev/null || echo 44)
ENTITY_COUNT=$(node -e 'const fs=require("fs"),p=require("path");const d=p.join(process.cwd(),"src","entities");console.log(fs.readdirSync(d,{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(p.join(d,e.name,"registry.ts"))).length)' 2>/dev/null || echo 18)
READONLY_TOOL_COUNT=$(node -e 'const r=require("./dist/src/registry-manager.js");const t=r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered();console.log(t.filter(x=>x.name.startsWith("browse_")||x.name==="manage_context").length)' 2>/dev/null || echo 24)

echo "prepare-release: v${VERSION}, ${TOOL_COUNT} tools (${READONLY_TOOL_COUNT} read-only), ${ENTITY_COUNT} entities"

# Update server.json: version + description
jq --arg v "$VERSION" --arg tc "$TOOL_COUNT" \
  '.version = $v | .packages[0].version = $v | .description = "GitLab MCP server with " + $tc + " tools for projects, MRs, pipelines, work items, and more"' \
  server.json > server.tmp && mv server.tmp server.json

# Update README.md: replace tool/entity counts (GNU sed on ubuntu-latest)
# Plain text: "NN tools across NN entity types"
sed -i -E "s/([^*])[0-9]+ tools across [0-9]+ entity types/\1${TOOL_COUNT} tools across ${ENTITY_COUNT} entity types/g" README.md
# Markdown bold: "**NN tools** across NN entity types"
sed -i -E "s/\*\*[0-9]+ tools\*\* across [0-9]+ entity types/\*\*${TOOL_COUNT} tools\*\* across ${ENTITY_COUNT} entity types/g" README.md
# "All NN tools"
sed -i -E "s/All [0-9]+ tools/All ${TOOL_COUNT} tools/g" README.md

# Write version file for CI
echo "$VERSION" > .semantic-release-version
