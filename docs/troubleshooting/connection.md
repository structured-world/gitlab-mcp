---
title: Connection Issues
description: "Fix GitLab MCP Server connection problems including token errors, SSL certificates, timeouts, proxy configuration, and missing tools. Detailed solutions for 401/403 errors and network issues."
head:
  - - meta
    - name: keywords
      content: GitLab MCP connection, token issues, SSL errors, timeout, proxy, self-signed certificates, troubleshooting
faq:
  - question: "How do I fix '401 Unauthorized' error in GitLab MCP?"
    answer: "The 401 error means your token is invalid, expired, or revoked. Verify your token in GitLab Settings > Access Tokens, check the expiration date, and create a new token if needed. Update your MCP client configuration with the new token."
  - question: "How do I fix '403 Forbidden' error on specific operations?"
    answer: "The 403 error indicates your token is missing required scopes. For full access, your token needs 'api' and 'read_user' scopes. For read-only mode, use 'read_api' and 'read_user' scopes."
  - question: "How do I connect GitLab MCP to a self-hosted GitLab with self-signed certificates?"
    answer: "Add your CA certificate using NODE_EXTRA_CA_CERTS environment variable in your MCP client config. Set it to the path of your CA certificate PEM file. This trusts only your specific CA while keeping TLS validation active."
  - question: "Why are some GitLab MCP tools not available?"
    answer: "Tools may be missing due to: 1) Feature flags disabled (check with list-tools --env), 2) Read-only mode enabled (only browse_* tools available), 3) GITLAB_DENIED_TOOLS_REGEX filtering tools, or 4) GitLab tier restrictions (some tools require Premium/Ultimate)."
  - question: "How do I fix timeout errors in GitLab MCP?"
    answer: "Increase the API timeout by setting GITLAB_API_TIMEOUT_MS environment variable to a higher value (default is 10000ms). You can also enable automatic retries with GITLAB_API_RETRY_ENABLED=true."
---

# Troubleshooting Connection Issues

Problems connecting GitLab MCP to your GitLab instance.

## Token Issues {#token-issues}

### "401 Unauthorized"

**Cause**: Invalid, expired, or revoked token.

**Fix**:
1. Verify your token in GitLab: **Settings > Access Tokens**
2. Check the token hasn't expired
3. Create a new token if needed
4. Update your MCP client configuration with the new token

### Token Format

GitLab tokens follow these formats:
- Personal Access Token: `glpat-xxxxxxxxxxxxxxxxxxxx`
- Project Access Token: `glpat-xxxxxxxxxxxxxxxxxxxx`
- Group Access Token: `glpat-xxxxxxxxxxxxxxxxxxxx`

Ensure no whitespace or newlines are included in your config.

## Scope Issues {#scopes}

For detailed scope requirements, token creation steps, and what breaks without `api` scope, see the [Authentication Guide — Scope Comparison](/guide/authentication#scope-comparison).

### "403 Forbidden" on Specific Operations

**Cause**: Token missing required scopes.

**Required scopes**:
| Scope | Purpose |
|-------|---------|
| `api` | Full API access (read and write) |
| `read_user` | Read user profile information |

**For read-only mode**, `read_api` scope is sufficient:
| Scope | Purpose |
|-------|---------|
| `read_api` | Read-only API access |
| `read_user` | Read user profile information |

### Creating a Token with Correct Scopes

1. Go to **GitLab > Settings > Access Tokens**
2. Click "Add new token"
3. Set expiration date
4. Select scopes: `api` and `read_user`
5. Click "Create personal access token"
6. Copy the token immediately (shown only once)

## URL Issues

### "ENOTFOUND" or "ECONNREFUSED"

**Cause**: Incorrect `GITLAB_API_URL`.

**Fix**:
- For gitlab.com: Use `https://gitlab.com` (or omit — it's the default)
- For self-hosted: Use the full URL with protocol, e.g., `https://gitlab.company.com`
- Do NOT include `/api/v4/` in the URL — the server adds this automatically

### Self-Signed Certificates

For GitLab instances with self-signed SSL certificates, add the CA certificate:

```json
{
  "env": {
    "NODE_EXTRA_CA_CERTS": "/path/to/your-ca-certificate.pem",
    "GITLAB_API_URL": "https://gitlab.internal.com"
  }
}
```

This is the recommended approach — it trusts only your specific CA while keeping TLS validation active.

::: danger Last resort only
If you cannot obtain the CA certificate, you can disable TLS verification entirely. This is **insecure** and should never be used in production:
```json
{
  "env": {
    "NODE_TLS_REJECT_UNAUTHORIZED": "0",
    "GITLAB_API_URL": "https://gitlab.internal.com"
  }
}
```
:::

For full TLS configuration options, see [TLS settings](/advanced/tls).

## Tools Missing {#tools-missing}

### Expected Tools Not Available

**Check 1**: Feature flags

```bash
npx @structured-world/gitlab-mcp list-tools --env
```

If a tool group is disabled, enable it:
```json
{
  "env": {
    "USE_WORKITEMS": "true",
    "USE_PIPELINE": "true"
  }
}
```

**Check 2**: Read-only mode

If `GITLAB_READ_ONLY_MODE=true`, only `browse_*` tools are available. Set to `false` for write access.

**Check 3**: Denied tools regex

Check if `GITLAB_DENIED_TOOLS_REGEX` is filtering out tools:
```json
{
  "env": {
    "GITLAB_DENIED_TOOLS_REGEX": ""
  }
}
```

**Check 4**: GitLab tier

Some tools require GitLab Premium or Ultimate. Check tier badges:
```bash
npx @structured-world/gitlab-mcp list-tools --detail
```

## Timeout Issues

### "ETIMEDOUT" or Slow Responses

**Cause**: Network issues or slow GitLab instance.

**Fix**: Increase the API timeout:

```json
{
  "env": {
    "GITLAB_API_TIMEOUT_MS": "30000"
  }
}
```

Default is `10000` (10 seconds).

### Retry Configuration

Enable automatic retries for transient failures:

```json
{
  "env": {
    "GITLAB_API_RETRY_ENABLED": "true",
    "GITLAB_API_RETRY_MAX_ATTEMPTS": "3",
    "GITLAB_API_RETRY_DELAY_MS": "1000"
  }
}
```

## Network Issues

### Behind a Corporate Proxy

Set proxy environment variables:

```json
{
  "env": {
    "HTTP_PROXY": "http://proxy.company.com:8080",
    "HTTPS_PROXY": "http://proxy.company.com:8080",
    "NO_PROXY": "localhost,127.0.0.1"
  }
}
```

### VPN or Firewall

Ensure your network allows HTTPS (port 443) connections to your GitLab instance.

## See Also

- [Configuration reference](/guide/configuration)
- [TLS/HTTPS](/advanced/tls)
- [OAuth Authentication](/security/oauth)
