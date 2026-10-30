#!/usr/bin/env bash
# Rebuilds the repository's plugin marketplace: .agents/plugins and
# plugins/gitlab-mcp at the repo root. The launcher resolves the published npm version;
# standalone ZIP builds embed production dependencies instead.
# Usage: ./scripts/build-plugin-marketplace.sh   (from packages/gitlab-mcp, after yarn build)
set -euo pipefail

node -e 'require("./dist/src/cli/plugin/build.js").buildPlugin({flavor: "private", npmRuntime: true, outDir: "../.."})' >/dev/null
rm -f ../../gitlab-mcp-*.zip
