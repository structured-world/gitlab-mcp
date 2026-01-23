# Connection Issues

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

For GitLab instances with self-signed SSL certificates:

```json
{
  "env": {
    "NODE_TLS_REJECT_UNAUTHORIZED": "0",
    "GITLAB_API_URL": "https://gitlab.internal.com"
  }
}
```

::: warning
Disabling TLS verification is insecure. For production, configure proper certificates via [TLS settings](/advanced/tls).
:::

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
