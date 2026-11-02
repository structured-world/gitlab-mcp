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

# Load the complete catalog once. A missing build or registry failure aborts generation.
CATALOG=$(node dist/src/cli/tool-catalog.js)
TOOL_COUNT=$(printf '%s' "$CATALOG" | jq -er '.metrics.toolCount')
CQRS_TOOL_COUNT=$(printf '%s' "$CATALOG" | jq -er '.metrics.cqrsToolCount')
HELPER_TOOL_COUNT=$(printf '%s' "$CATALOG" | jq -er '.metrics.helperToolCount')
TOOL_GROUP_COUNT=$(printf '%s' "$CATALOG" | jq -er '.metrics.toolGroupCount')
READONLY_TOOL_COUNT=$(printf '%s' "$CATALOG" | jq -er '.metrics.readonlyToolCount')
ACTION_COUNT=$(printf '%s' "$CATALOG" | jq -er '.metrics.actionCount')
DESCRIPTION=$(printf '%s' "$CATALOG" | jq -er '.metrics.description')

echo "prepare-release: v${VERSION}, ${DESCRIPTION} (${READONLY_TOOL_COUNT} available in read-only mode)"

# Update server.json: version + description.
# The description is the public marketing line shown on the MCP Registry listing,
# so it mirrors the README metrics (tools / typed actions / tool groups) instead
# of a generic blurb. The MCP Registry schema caps description at 100 chars; this
# phrasing stays well under that even with 3-digit counts.
# Note: set -e ensures script exits on jq failure; leftover server.tmp is benign
# (gitignored, cleaned by next successful run, doesn't affect release)
jq --arg v "$VERSION" --arg description "$DESCRIPTION" \
  '.version = $v | .packages[0].version = $v | .description = $description' \
  server.json > server.tmp && mv server.tmp server.json

# Generate README.md from the template for each location it ships to. Repo files are
# referenced through two bases: __REPO_BASE__ for links (LICENSE, CONTRIBUTING) and
# __ASSET_BASE__ for images. The GitHub repo page resolves paths relative to the
# repo root. npm does not: it joins a relative path onto the repository URL, which
# yields a GitHub page address instead of the file, so the READMEs published to npm
# get absolute bases (blob URLs for links, raw URLs for images).
#   packages/gitlab-mcp/README.md    (npm core page)    -> absolute
#   <repo root>/README.md            (GitHub repo page)  -> .
#   packages/gitlab-mcp-db/README.md (npm db page)       -> absolute
if [[ ! -f "README.md.in" ]]; then
  echo "ERROR: README.md.in not found" >&2
  exit 1
fi
NPM_LINK_BASE="https://github.com/structured-world/gitlab-mcp/blob/HEAD"
NPM_ASSET_BASE="https://raw.githubusercontent.com/structured-world/gitlab-mcp/HEAD"
render_readme() {
  # $1 = output path, $2 = link base, $3 = image base
  sed -e "s/__TOOL_COUNT__/${TOOL_COUNT}/g" \
      -e "s/__ACTION_COUNT__/${ACTION_COUNT}/g" \
      -e "s/__TOOL_GROUP_COUNT__/${TOOL_GROUP_COUNT}/g" \
      -e "s/__CQRS_TOOL_COUNT__/${CQRS_TOOL_COUNT}/g" \
      -e "s/__HELPER_TOOL_COUNT__/${HELPER_TOOL_COUNT}/g" \
      -e "s/__READONLY_TOOL_COUNT__/${READONLY_TOOL_COUNT}/g" \
      -e "s/__VERSION__/${VERSION}/g" \
      -e "s|__REPO_BASE__|$2|g" \
      -e "s|__ASSET_BASE__|$3|g" \
      README.md.in > "$1"
}
render_readme README.md "$NPM_LINK_BASE" "$NPM_ASSET_BASE"
render_readme ../../README.md . .
render_readme ../gitlab-mcp-db/README.md "$NPM_LINK_BASE" "$NPM_ASSET_BASE"

# Update MCP manifest tools list in package.json
# Reuse the same catalog and metrics that rendered the README and Registry entry.
echo "Updating MCP manifest in package.json..."
printf '%s\n' "$CATALOG" | node scripts/update-mcp-manifest.js

# Rebuild the repository's plugin marketplace, so its manifest carries this version.
./scripts/build-plugin-marketplace.sh

# Write version file for CI
echo "$VERSION" > .semantic-release-version
