---
title: Docker Container Management CLI
description: "Manage GitLab MCP Docker containers with the docker subcommand. Start, stop, restart, upgrade containers, and manage multiple GitLab instances with add-instance and remove-instance."
head:
  - - meta
    - name: keywords
      content: gitlab mcp docker, mcp server docker, docker compose gitlab mcp, gitlab mcp container, multi-instance gitlab, gitlab mcp deployment
---

# Docker Container Management CLI

Manage the GitLab MCP Docker container and GitLab instances.

## Usage

```bash
gitlab-mcp docker <subcommand> [options]
```

## Subcommands

| Command | Description |
|---------|-------------|
| `status` | Show container and instance status |
| `init` | Initialize Docker configuration (alias for `setup --mode=server`) |
| `start` | Start the container |
| `stop` | Stop the container |
| `restart` | Restart the container |
| `upgrade` | Pull latest image and restart |
| `logs` | Show container logs |
| `add-instance` | Add a GitLab instance |
| `remove-instance` | Remove a GitLab instance |

## status

Display Docker environment, container state, and configured instances:

```bash
gitlab-mcp docker status
```

Output includes:
- Docker installation and daemon status
- Container name, status, image, ports
- Configured GitLab instances with OAuth and preset info
- Config directory path

## init

Interactive setup for Docker deployment. Equivalent to `gitlab-mcp setup --mode=server`:

```bash
gitlab-mcp docker init
```

Walks through:
1. Docker and Compose prerequisites check
2. Port configuration
3. OAuth enablement (optional)
4. docker-compose.yml generation
5. Optional container start

## start

Start the gitlab-mcp container:

```bash
gitlab-mcp docker start
```

## stop

Stop the running container:

```bash
gitlab-mcp docker stop
```

## restart

Restart the container:

```bash
gitlab-mcp docker restart
```

## upgrade

Pull the latest image and restart:

```bash
gitlab-mcp docker upgrade
```

## logs

Show container logs:

```bash
# Last 100 lines
gitlab-mcp docker logs

# Follow logs in real-time
gitlab-mcp docker logs -f

# Custom line count
gitlab-mcp docker logs --lines=500
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f`, `--follow` | Tail logs in real-time | `false` |
| `--lines=N` | Number of lines to show | `100` |

## add-instance

Add a GitLab instance to the Docker configuration:

```bash
# Interactive
gitlab-mcp docker add-instance

# With host specified
gitlab-mcp docker add-instance gitlab.company.com
```

The wizard prompts for:
- GitLab host (if not provided)
- Display name
- OAuth configuration (optional: Application ID, secret env var)
- Default preset (developer, senior-dev, full-access, devops, code-reviewer, readonly)

## remove-instance

Remove a configured GitLab instance:

```bash
gitlab-mcp docker remove-instance gitlab.company.com
```

Restart the container after removing an instance for changes to take effect.

## Configuration Directory

Docker configuration is stored in `~/.config/gitlab-mcp/`:

```
~/.config/gitlab-mcp/
├── docker-compose.yml
├── .env
└── instances/
    └── <host>.json
```

## Examples

```bash
# Full Docker lifecycle
gitlab-mcp docker init          # Initial setup
gitlab-mcp docker start         # Start container
gitlab-mcp docker status        # Check status
gitlab-mcp docker logs -f       # Monitor logs
gitlab-mcp docker upgrade       # Update to latest
gitlab-mcp docker stop          # Stop container

# Multi-instance management
gitlab-mcp docker add-instance gitlab.com
gitlab-mcp docker add-instance gitlab.company.com
gitlab-mcp docker status
gitlab-mcp docker remove-instance gitlab.com
```

## See Also

- [`gitlab-mcp setup`](/cli/setup) — full setup wizard
- [Docker standalone deployment](/deployment/docker-standalone)
- [Docker Compose deployment](/deployment/docker-compose)
