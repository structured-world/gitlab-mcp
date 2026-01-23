# gitlab-mcp init

Alias for `gitlab-mcp setup --mode=local`. Runs the setup wizard in local (stdio) mode, skipping mode selection.

## Usage

```bash
gitlab-mcp init
```

## Behavior

Equivalent to:

```bash
gitlab-mcp setup --mode=local
```

The wizard runs through:

1. **GitLab instance** — gitlab.com or self-hosted URL
2. **Authentication** — Token entry with optional browser launch
3. **Connection test** — Verify API access
4. **Tool configuration** — Preset, manual, or advanced
5. **Client detection** — Find installed MCP clients
6. **Installation** — Write config to selected clients

## When to Use

Use `init` when you:
- Want a local stdio setup for AI IDE clients
- Don't need Docker/server deployment
- Want to skip the mode selection prompt

## Examples

```bash
# Via npx
npx @structured-world/gitlab-mcp init

# If installed globally
gitlab-mcp init
```

## See Also

- [`gitlab-mcp setup`](/cli/setup) — full wizard with mode selection
- [`gitlab-mcp install`](/cli/install) — install to specific clients only
- [Local stdio deployment](/deployment/local-stdio)
