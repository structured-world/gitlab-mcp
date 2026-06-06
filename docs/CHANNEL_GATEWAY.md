# Channel Gateway (CI watch + completion notifications)

The channel gateway is a local front door for a Claude Code session that
re-exposes the full gitlab-mcp tool catalog and, in addition, watches running
CI pipelines and pushes their state changes into the session asynchronously.

It exists because an agent that asks for a pipeline status while it is still
running otherwise has to poll by re-issuing tool calls (token-expensive) and has
no way to be told when the pipeline finishes. The gateway turns that into a push:
trigger or query a pipeline once, and receive a `<channel>` event on each state
change and on completion.

> Status: research-preview. Delivery relies on Claude Code **Channels**, which
> is preview-gated: custom channels require `--dangerously-load-development-channels`
> and an Anthropic (claude.ai) login, and events are only delivered while the
> session is running.

## How it works

One process is both:

- a **downstream MCP client** to gitlab-mcp (the real tool catalog), and
- an **upstream channel-protocol MCP server** to Claude Code.

Every tool call is forwarded verbatim to gitlab-mcp. The only added behavior is a
single forward-path hook: when a result is a non-final CI resource (detected by
shape, not a tool-name list), the gateway arms a background **watch** for that
pipeline. The watch:

1. starts a poll timer the moment the pipeline id is known (from the `create`
   response, or a `get` / `jobs` read),
2. polls the pipeline's jobs on an interval (one call covers the whole DAG),
3. emits a `<channel>` event on every per-job state change, and
4. emits a final event and deregisters when the pipeline reaches a terminal
   state (`success` / `failed` / `canceled` / `skipped`).

Watches live only in this local, per-session process; gitlab-mcp itself stays
request/response with no in-process watch state, so the multi-instance model is
unaffected.

Forwarding is connection-resilient: the downstream link reconnects with
exponential backoff; reads (`browse_*` / `get_*` / `list_*`) are retried once
after a reconnect because they are idempotent, while writes (`manage_*`) are
never blind-retried to avoid double execution.

## Setup

Build first so `dist/` exists:

```bash
yarn build
```

Register the gateway as a channel in `.mcp.json` (project-level or
`~/.claude.json`):

```json
{
  "mcpServers": {
    "gitlab-ci": {
      "command": "node",
      "args": ["dist/src/channel-gateway/main.js"],
      "env": {
        "GITLAB_API_URL": "https://gitlab.example.com",
        "GITLAB_TOKEN": "<token>"
      }
    }
  }
}
```

Then launch Claude Code with the channel enabled:

```bash
claude --dangerously-load-development-channels server:gitlab-ci
```

Events arrive in the session as `<channel source="gitlab-ci" ...>` tags, e.g.:

```
<channel source="gitlab-ci" pipeline_id="1397" state="success" terminal="true">
Pipeline #1397 (project test/ci-watch-poc) finished: success. Jobs: build:success test-a:success test-b:success deploy:success
</channel>
```

## Configuration

The gateway inherits its environment from its own process and passes it to the
downstream gitlab-mcp, so the usual gitlab-mcp variables (`GITLAB_TOKEN`,
`GITLAB_API_URL`, `USE_*` gates, OAuth settings) apply. Gateway-specific knobs:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GATEWAY_DOWNSTREAM_COMMAND` | `node` | Executable that launches gitlab-mcp |
| `GATEWAY_DOWNSTREAM_ARGS` | `dist/src/main.js stdio` | Args for the downstream process |
| `GATEWAY_POLL_MS` | `10000` | Watch poll interval in milliseconds |

## Limitations

- Delivery requires a running session; a dead session is not woken.
- Custom-channel support is dev-only during the Channels research preview.
- The watch covers pipelines and single jobs; deployment resources are not yet
  watched.
