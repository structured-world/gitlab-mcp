#!/bin/bash

# Quick MCP tester - sends init sequence + payload from $1
set -e

if [[ -z "$1" ]]; then
    echo "Usage: $0 'tool_params'"
    echo "Example: $0 '{\"name\": \"list_work_items\", \"arguments\": {\"namespacePath\": \"test\"}}'"
    exit 1
fi

# Load environment variables from .env.test
if [[ -f .env.test ]]; then
    set -a
    source .env.test
    set +a
fi

# Disable SSE
export SSE=false

# Debug output (enable with DEBUG=1)
if [[ "$DEBUG" == "1" ]]; then
    echo "🚀 Starting MCP stdio with test environment..."
fi

PAYLOAD='{"jsonrpc": "2.0", "id": "3", "method": "tools/call", "params": '$1'}'

# Create temp file with init sequence + payload
TEMP_INPUT=$(mktemp)
cat > "$TEMP_INPUT" << EOF
{"jsonrpc": "2.0", "id": "init", "method": "initialize", "params": {"protocolVersion": "1.0", "capabilities": {"tools": {}}, "clientInfo": {"name": "test-client", "version": "1.0"}}}
{"jsonrpc": "2.0", "id": "ready", "method": "notifications/initialized"}
$PAYLOAD
EOF

if [[ "$DEBUG" == "1" ]]; then
    echo "📤 Sending:"
    echo "  Init sequence + payload"
    echo "  Payload: $PAYLOAD"
    echo ""
fi

# Run MCP and send commands.
# Use the compiled dist build: ts-node cannot resolve the project's .js ESM
# import specifiers at runtime, so we run the emitted JavaScript instead.
if [[ ! -f dist/src/main.js ]]; then
    echo "dist/src/main.js missing - run 'yarn build' first" >&2
    rm -f "$TEMP_INPUT"
    exit 1
fi
node dist/src/main.js stdio < "$TEMP_INPUT"

# Remove temp file
rm -f "$TEMP_INPUT"