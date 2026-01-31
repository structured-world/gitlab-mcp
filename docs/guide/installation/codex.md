---
title: OpenAI Codex Setup
description: "Configure GitLab MCP Server with OpenAI Codex CLI for AI-assisted GitLab development workflows"
head:
  - - meta
    - name: keywords
      content: gitlab mcp codex, openai codex, codex cli, config.toml, ai-assisted development, gitlab mcp integration
---

# Codex Installation

Configure GitLab MCP Server for use with OpenAI Codex.

## Configuration

Add to your `~/.codex/config.toml`:

```toml
[mcp_servers.gitlab]
command = "yarn"
args = ["dlx", "-q", "@structured-world/gitlab-mcp@latest", "stdio"]
env = { "GITLAB_TOKEN" = "your_token", "GITLAB_API_URL" = "https://gitlab.com" }
```

## With Feature Flags

```toml
[mcp_servers.gitlab]
command = "yarn"
args = ["dlx", "-q", "@structured-world/gitlab-mcp@latest", "stdio"]

[mcp_servers.gitlab.env]
GITLAB_TOKEN = "your_token"
GITLAB_API_URL = "https://gitlab.com"
USE_PIPELINE = "true"
USE_MILESTONE = "true"
USE_GITLAB_WIKI = "true"
```
