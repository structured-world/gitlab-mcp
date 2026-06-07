---
title: Channel Gateway (CI watch + completion notifications)
description: "Local channel-gateway for Claude Code that re-exposes the GitLab MCP catalog and pushes CI pipeline/job state changes into the session as channel events. Watches running pipelines and notifies on completion."
head:
  - - meta
    - name: keywords
      content: gitlab mcp channel gateway, ci watch, pipeline notifications, claude code channels, completion notifications
---

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

## Run Claude Code with the gateway

Three steps: build, register the channel, launch Claude Code with it enabled.

### 1. Build

```bash
yarn build
```

This produces `dist/src/channel-gateway/main.js`. The gateway resolves the
downstream gitlab-mcp relative to itself, so it runs from any working directory;
you only point Claude Code at this one file.

### 2. Register the channel in `.mcp.json`

Add the gateway to a project-level `.mcp.json` or to `~/.claude.json`. Use an
absolute path to the built entry point so it resolves regardless of where Claude
Code is launched:

```json
{
  "mcpServers": {
    "gitlab-ci": {
      "command": "node",
      "args": ["/absolute/path/to/gitlab-mcp/dist/src/channel-gateway/main.js"],
      "env": {
        "GITLAB_API_URL": "https://gitlab.example.com",
        "GITLAB_TOKEN": "<token>",
        "GATEWAY_POLL_MS": "10000"
      }
    }
  }
}
```

For OAuth deployments, pass the OAuth variables here instead of `GITLAB_TOKEN`
(the gateway forwards its environment to the downstream gitlab-mcp unchanged).

### 3. Launch Claude Code

```bash
claude --dangerously-load-development-channels server:gitlab-ci
```

`--dangerously-load-development-channels` is required while custom channels are
in the Channels research preview; `server:gitlab-ci` matches the key under
`mcpServers` above. The session now has the full gitlab-mcp tool catalog AND
receives CI events as they happen.

> Convenience: `yarn channel-gateway` runs the same entry point directly (for a
> smoke check or to drive it from another launcher).

Events arrive in the session as `<channel source="gitlab-ci" ...>` tags, e.g.:

```text
<channel source="gitlab-ci" pipeline_id="1397" state="success" terminal="true">
Pipeline #1397 (project test/ci-watch-poc) finished: success. Jobs: build:success test-a:success test-b:success deploy:success
</channel>
```

## Configuration

The gateway forwards its own environment to the downstream gitlab-mcp (only
unset values are dropped), so the usual gitlab-mcp variables (`GITLAB_API_URL`,
`USE_*` gates, and either a static `GITLAB_TOKEN` or the OAuth settings) apply.
For an OAuth deployment, provide the OAuth variables here instead of a static
`GITLAB_TOKEN`. Gateway-specific knobs:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GATEWAY_DOWNSTREAM_COMMAND` | `node` | Executable that launches gitlab-mcp |
| `GATEWAY_DOWNSTREAM_ARGS` | `dist/src/main.js stdio` | Args for the downstream process |
| `GATEWAY_POLL_MS` | `10000` | Watch poll interval in milliseconds |

## Limitations

- Delivery requires a running session; a dead session is not woken.
- Custom-channel support is dev-only during the Channels research preview.
- Watches cover pipelines and deployments. A single job is not watched on its
  own (its id is a job id, not a pipeline id); watch its pipeline instead. A
  deployment is re-queried through the project's deployment list (there is no
  single-deployment read), so a watched deployment is matched by id within that
  list.
