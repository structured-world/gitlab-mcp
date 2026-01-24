---
title: Auto-Discovery
description: "Automatic GitLab instance detection from git remotes — zero-config setup for local repositories"
---

# Auto-Discovery

The `--auto` flag automatically detects GitLab configuration from the current git repository's remote URL.

## Usage

```bash
# Auto-discover from current directory
gitlab-mcp --auto

# Auto-discover from specific directory
gitlab-mcp --auto --cwd /path/to/repo

# Use specific remote (default: origin)
gitlab-mcp --auto --remote upstream

# Dry-run: see what would be detected without applying
gitlab-mcp --auto --dry-run
```

## Configuration Priority

When multiple configuration sources are available, they are applied in this order (highest to lowest priority):

| Priority | Source | What it provides |
|----------|--------|------------------|
| 1 (highest) | `--profile` CLI argument | Selects user profile (host, auth, features) |
| 2 | Project config files (`.gitlab-mcp/`) | Defines intended restrictions and tool selection (detected/logged, not yet enforced) |
| 3 (lowest) | Auto-discovered profile | Fallback profile selection from git remote |

### Important Notes

- **`--profile` always wins**: If you specify `--profile work`, it will be used even if auto-discovery detected a different profile. A warning is logged when this happens.
- **Project config is not yet enforced**: The `.gitlab-mcp/` directory configuration (preset.yaml, profile.yaml) defines restrictions ON TOP of the selected profile — it doesn't replace it. Currently these files are detected and logged but automatic enforcement is not yet implemented.
- **Auto-discovery sets defaults**: Even when a higher-priority source is used, auto-discovery still sets `GITLAB_DEFAULT_PROJECT` and `GITLAB_DEFAULT_NAMESPACE` from the git remote.

## How Auto-Discovery Works

1. Parses git remote URL (SSH or HTTPS format)
2. Extracts GitLab host and project path
3. Matches host to configured user profiles
4. Sets default project context for convenience

## Supported URL Formats

- SSH: `git@gitlab.company.com:group/project.git`
- SSH with port: `ssh://git@gitlab.company.com:2222/group/project.git`
- HTTPS: `https://gitlab.company.com/group/project.git`
- HTTPS with port: `https://gitlab.company.com:8443/group/project.git`
