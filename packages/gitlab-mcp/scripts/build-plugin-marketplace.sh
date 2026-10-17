#!/usr/bin/env bash
# Rebuilds the repository's plugin marketplace from the compiled CLI: .agents/plugins and
# plugins/gitlab-mcp at the repo root. The package targets a local server in HTTP mode on
# the default port; the submission ZIP the build also writes is not kept.
# Usage: ./scripts/build-plugin-marketplace.sh   (from packages/gitlab-mcp, after yarn build)
set -euo pipefail

node dist/src/main.js plugin build --endpoint http://127.0.0.1:3002/mcp --out ../.. >/dev/null
rm -f ../../gitlab-mcp-*.zip
