#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-$(node -p "require('./package.json').version")}"
BUNDLE_DIR="$(mktemp -d)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Building MCPB bundle v${VERSION}..."

# 1. Copy built dist/ to bundle
if [ ! -d "$PROJECT_DIR/dist" ]; then
  echo "Error: dist/ not found. Run 'yarn build' before building MCPB bundle." >&2
  exit 1
fi
cp -r "$PROJECT_DIR/dist" "$BUNDLE_DIR/dist"

# 2. Install production dependencies into bundle
cp "$PROJECT_DIR/package.json" "$BUNDLE_DIR/"
cd "$BUNDLE_DIR"
# Use npm for production install (simpler for bundling, no yarn PnP)
# --omit=peer prevents installing prisma CLI and typescript as @prisma/client peer deps
if ! npm install --production --ignore-scripts --omit=peer 2>/dev/null; then
  echo "Warning: npm install --production failed; continuing bundle build" >&2
fi

# 3. Copy prisma schema (needed for runtime migrations)
if [ -d "$PROJECT_DIR/prisma" ]; then
  cp -r "$PROJECT_DIR/prisma" "$BUNDLE_DIR/prisma"
fi

# 4. Generate manifest from template
TOOL_COUNT=$(node -e "const r=require('$PROJECT_DIR/dist/src/registry-manager.js');console.log(r.RegistryManager.getInstance().getAllToolDefinitionsUnfiltered().length)" 2>/dev/null || echo 44)
ENTITY_COUNT=$(node -e "const fs=require('fs'),p=require('path'),d='$PROJECT_DIR/src/entities';console.log(fs.readdirSync(d,{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(p.join(d,e.name,'registry.ts'))).length)" 2>/dev/null || echo 18)
sed -e "s/{{VERSION}}/$VERSION/g" -e "s/{{TOOL_COUNT}}/$TOOL_COUNT/g" -e "s/{{ENTITY_COUNT}}/$ENTITY_COUNT/g" "$PROJECT_DIR/mcpb/manifest.json.template" > "$BUNDLE_DIR/manifest.json"

# 5. Copy icon
if [ -f "$PROJECT_DIR/mcpb/icon.png" ]; then
  cp "$PROJECT_DIR/mcpb/icon.png" "$BUNDLE_DIR/icon.png"
fi

# 6. Clean up unnecessary files
rm -rf "$BUNDLE_DIR/yarn.lock" "$BUNDLE_DIR/.yarn"
rm -f "$BUNDLE_DIR/package-lock.json"

# Remove docs, licenses, changelogs, TypeScript source files
find "$BUNDLE_DIR/node_modules" \( -name "*.md" -o -name "*.ts" -o -name "LICENSE*" -o -name "CHANGELOG*" \) -type f -exec rm -f {} + 2>/dev/null || true

# Remove test directories
find "$BUNDLE_DIR/node_modules" \( -name "__tests__" -o -name "test" -o -name "tests" \) -type d -exec rm -rf {} + 2>/dev/null || true

# Remove source maps from node_modules
find "$BUNDLE_DIR/node_modules" -name "*.js.map" -type f -exec rm -f {} + 2>/dev/null || true

# Remove TypeScript declarations from node_modules (not needed at runtime)
find "$BUNDLE_DIR/node_modules" -name "*.d.ts" -type f -exec rm -f {} + 2>/dev/null || true
find "$BUNDLE_DIR/node_modules" -name "*.d.mts" -type f -exec rm -f {} + 2>/dev/null || true

# Remove fixture/example/doc directories
find "$BUNDLE_DIR/node_modules" \( -name "fixture" -o -name "fixtures" -o -name "examples" -o -name "example" -o -name "doc" -o -name "docs" \) -type d -exec rm -rf {} + 2>/dev/null || true

# Remove build artifacts from dist/
rm -f "$BUNDLE_DIR/dist/tsconfig.build.tsbuildinfo"
find "$BUNDLE_DIR/dist" -name "*.js.map" -type f -exec rm -f {} + 2>/dev/null || true

# 7. Create .mcpb (ZIP archive)
OUTPUT="$PROJECT_DIR/gitlab-mcp-${VERSION}.mcpb"
cd "$BUNDLE_DIR"
zip -r "$OUTPUT" . -x "*.DS_Store" > /dev/null

# 8. Cleanup
rm -rf "$BUNDLE_DIR"

SIZE=$(stat -f%z "$OUTPUT" 2>/dev/null || stat -c%s "$OUTPUT")
SIZE_MB=$(echo "scale=1; $SIZE / 1048576" | bc)
echo "Bundle created: $OUTPUT (${SIZE_MB} MB)"
