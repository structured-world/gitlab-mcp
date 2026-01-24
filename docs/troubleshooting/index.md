---
title: Common Issues
description: "Troubleshoot GitLab MCP Server — common problems with tokens, connections, and tool availability"
---

# Troubleshooting

Solutions for common issues with GitLab MCP.

## Quick Diagnosis

| Symptom | Likely Cause | Guide |
|---------|--------------|-------|
| "Connection refused" | Server not running or wrong port | [Connection](/troubleshooting/connection) |
| "401 Unauthorized" | Invalid or expired token | [Connection](/troubleshooting/connection#token-issues) |
| "403 Forbidden" | Insufficient token scopes | [Connection](/troubleshooting/connection#scopes) |
| "No clients detected" | Client not installed or not detected | [Clients](/troubleshooting/clients) |
| Server not appearing in client | Config file issue | [Clients](/troubleshooting/clients#config-not-loaded) |
| Docker container won't start | Port conflict or missing env vars | [Docker](/troubleshooting/docker) |
| Tools not available | Feature flags or read-only mode | [Connection](/troubleshooting/connection#tools-missing) |

## General Steps

### 1. Check Configuration

Preview your current configuration:

```bash
npx @structured-world/gitlab-mcp install --show --claude-desktop
```

### 2. Test Connection

Verify your token and API access:

```bash
curl -H "PRIVATE-TOKEN: glpat-xxxx" \
  https://gitlab.com/api/v4/user
```

### 3. Check Logs

For Docker deployments:

```bash
gitlab-mcp docker logs -f
```

For stdio mode, check your MCP client's logs:
- **Claude Desktop**: `~/Library/Logs/Claude/mcp*.log` (macOS)
- **Cursor**: Developer Tools (`Cmd+Shift+I`) > Console
- **VS Code**: Output panel > "MCP" channel

### 4. Verify Environment

Check which tools are available with current settings:

```bash
npx @structured-world/gitlab-mcp list-tools --env
```

## Getting Help

If your issue isn't covered here:

1. Check the [GitLab MCP GitHub Issues](https://github.com/structured-world/gitlab-mcp/issues)
2. Search existing issues for similar problems
3. Open a new issue with:
   - GitLab MCP version (`npx @structured-world/gitlab-mcp --version`)
   - Node.js version (`node --version`)
   - MCP client name and version
   - Error message or unexpected behavior
   - Minimal reproduction steps
