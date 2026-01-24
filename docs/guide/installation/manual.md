---
title: Manual Installation
description: "Build GitLab MCP Server from source — clone, install dependencies, build, and configure manually"
---

# Manual Configuration

For users who prefer full control over their setup, you can configure GitLab MCP manually by editing your MCP client's configuration file directly.

## Configuration Format

All MCP clients use a JSON configuration with the same structure:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com"
      }
    }
  }
}
```

## Step-by-Step

### 1. Create a GitLab Token

Follow the [Authentication Guide](/guide/authentication#create-token) for detailed steps, or briefly:

1. Go to **Settings > Access Tokens** in your GitLab instance
2. Create a token with `api` and `read_user` scopes
3. Copy the token value

### 2. Find Your Config File

See [Supported Clients](/clients/) for the config file location specific to your client and operating system.

### 3. Edit the Configuration

Add the `gitlab` entry to the `mcpServers` object in your config file. If the file doesn't exist, create it with the full JSON structure above.

### 4. Set Environment Variables

Add any desired [configuration options](/guide/configuration) to the `env` object:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "glpat-xxxxxxxxxxxxxxxxxxxx",
        "GITLAB_API_URL": "https://gitlab.company.com",
        "GITLAB_PROJECT_ID": "42",
        "GITLAB_READ_ONLY_MODE": "false",
        "USE_WORKITEMS": "true",
        "USE_PIPELINE": "true"
      }
    }
  }
}
```

### 5. Restart Your Client

After saving the config file, restart your MCP client to load the new configuration.

## Alternative: Yarn dlx

If you prefer Yarn:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "yarn",
      "args": ["dlx", "-q", "@structured-world/gitlab-mcp@latest", "stdio"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com"
      }
    }
  }
}
```

## Alternative: Docker (stdio)

For containerized execution:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITLAB_TOKEN",
        "-e", "GITLAB_API_URL",
        "ghcr.io/structured-world/gitlab-mcp:latest"
      ],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com"
      }
    }
  }
}
```

## Alternative: HTTP/SSE Remote Server

For connecting to a running GitLab MCP server:

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "streamable-http",
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

## Verifying Configuration

Use the `install --show` command to preview the generated configuration for any client:

```bash
npx @structured-world/gitlab-mcp install --show --claude-desktop
```

## Next Steps

- [Environment Variables reference](/guide/configuration)
- [Feature Flags](/guide/quick-start#feature-flags)
- [Transport Modes](/guide/transport)
