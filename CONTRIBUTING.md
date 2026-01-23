# Contributing

Thank you for your interest in contributing to GitLab MCP Server!

## Development Setup

### Prerequisites

- Node.js >= 24.0.0
- Yarn 4+
- A GitLab instance with API access (for integration tests)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/structured-world/gitlab-mcp.git
cd gitlab-mcp

# Install dependencies
yarn install

# Build the project
yarn build
```

### Development Servers

```bash
# stdio mode (with .env.test auto-loaded)
yarn dev:stdio

# SSE/HTTP mode
yarn dev:sse
```

## Testing

### Test Types

| Command | Description |
|---------|-------------|
| `yarn test` | Unit tests only (fast, safe default) |
| `yarn test <pattern>` | Unit tests matching pattern |
| `yarn test:cov` | Unit tests with coverage report |
| `yarn test:integration` | Integration tests (needs `.env.test`) |
| `yarn test:all` | Full suite (unit + integration) |
| `yarn test:env-gating` | Test environment variable gating |

### Integration Tests

Integration tests run against a real GitLab instance. Create `.env.test`:

```bash
GITLAB_TOKEN=your_test_token
GITLAB_API_URL=https://your-gitlab-instance.com
# Add other required variables
```

Then run:

```bash
yarn test:integration
```

### Quick Tool Testing

Test individual MCP tools directly:

```bash
./scripts/test_mcp.sh '{"name": "browse_work_items", "arguments": {"action": "list", "namespace": "test"}}'
```

The script automatically:
- Loads environment from `.env.test`
- Sends proper MCP initialization sequence
- Executes the tool call with JSON-RPC formatting

### Test Architecture

- **200+ integration tests** running against real GitLab instance
- **Data lifecycle pattern** — Creates test infrastructure once, shared across dependent tests
- **Schema validation** — All schemas validated against real API responses
- **Dependency chain** — Tests run in proper order using `--runInBand`

For detailed testing documentation, see [TESTING.md](TESTING.md).

## Code Standards

### TypeScript

- Strict TypeScript with no `any` types
- All code must pass `yarn lint` with zero errors
- ESM modules with `.js` extensions in imports
- Zod schemas for all external data validation

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(entity): add new capability
fix(oauth): resolve token refresh issue
docs: update installation guide
chore(deps): update dependencies
```

### Pre-Push Checklist

1. `yarn lint` — Zero errors
2. `yarn test` — All tests pass
3. `yarn build` — Builds successfully

## Architecture

### Entity Pattern

Each GitLab entity (projects, merge requests, etc.) follows:

```
src/entities/<entity>/
├── registry.ts          # Tool definitions and schemas
├── handlers.ts          # Request handlers
├── types.ts             # TypeScript interfaces
└── __tests__/           # Unit tests
```

### CQRS Pattern

Tools use Command Query Responsibility Segregation:

- `browse_*` — Read-only query operations
- `manage_*` — Write/command operations

Each tool has a discriminated union schema with an `action` parameter.

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes following code standards
3. Ensure all tests pass
4. Submit a PR with a clear description
5. Address review feedback

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
