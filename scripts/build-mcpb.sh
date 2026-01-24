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
cp "$PROJECT_DIR/yarn.lock" "$BUNDLE_DIR/"
cd "$BUNDLE_DIR"
# Use npm for production install (simpler for bundling, no yarn PnP)
if ! npm install --production --ignore-scripts 2>/dev/null; then
  echo "Warning: npm install --production failed; continuing bundle build" >&2
fi

# 3. Copy prisma schema and generate
if [ -d "$PROJECT_DIR/prisma" ]; then
  cp -r "$PROJECT_DIR/prisma" "$BUNDLE_DIR/prisma"
  if ! npx prisma generate 2>/dev/null; then
    echo "Warning: prisma generate failed; continuing bundle build" >&2
  fi
fi

# 4. Generate manifest from template
sed "s/{{VERSION}}/$VERSION/g" "$PROJECT_DIR/mcpb/manifest.json.template" > "$BUNDLE_DIR/manifest.json"

# 5. Copy icon if exists
if [ -f "$PROJECT_DIR/mcpb/icon.png" ]; then
  cp "$PROJECT_DIR/mcpb/icon.png" "$BUNDLE_DIR/icon.png"
fi

# 6. Clean up unnecessary files
rm -rf "$BUNDLE_DIR/yarn.lock" "$BUNDLE_DIR/.yarn"
find "$BUNDLE_DIR/node_modules" \( -name "*.md" -o -name "*.ts" -o -name "LICENSE*" -o -name "CHANGELOG*" \) -type f -exec rm -f {} + 2>/dev/null || true
find "$BUNDLE_DIR/node_modules" \( -name "__tests__" -o -name "test" -o -name "tests" \) -type d -exec rm -rf {} + 2>/dev/null || true

# 7. Create .mcpb (ZIP archive)
OUTPUT="$PROJECT_DIR/gitlab-mcp-${VERSION}.mcpb"
cd "$BUNDLE_DIR"
zip -r "$OUTPUT" . -x "*.DS_Store" > /dev/null

# 8. Cleanup
rm -rf "$BUNDLE_DIR"

echo "Bundle created: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
