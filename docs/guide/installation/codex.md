---
title: OpenAI Codex Installation Guide
description: "Configure GitLab MCP Server with OpenAI Codex CLI. Add to config.toml with environment variables and feature flags for AI-assisted GitLab development workflows."
head:
  - - meta
    - name: keywords
      content: gitlab mcp codex, openai codex, codex cli, config.toml, ai-assisted development, gitlab mcp integration
---

# OpenAI Codex Installation Guide

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
