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
    answer: "Increase the API timeout by setting GITLAB_API_HEADERS_TIMEOUT_MS (default 10000ms) or GITLAB_API_BODY_TIMEOUT_MS (default 30000ms) to a higher value. You can also enable automatic retries with GITLAB_API_RETRY_ENABLED=true."
---

# Troubleshooting Connection Issues

Problems connecting GitLab MCP to your GitLab instance.

## Diagnose the Current Connection

Call `manage_context` with `{ "action": "whoami" }` to check the account used by
the current chat. If the user lookup fails, `user` is `null` and `userLookupError`
explains the failure:

| Kind | Meaning | Next step |
|------|---------|-----------|
| `tls` | Certificate verification failed | Check the certificate hostname, validity and CA chain. The returned `hint` explains `GITLAB_CA_CERT_PATH` and `NODE_EXTRA_CA_CERTS`. |
| `dns` | Hostname resolution failed | Check the instance URL, DNS and proxy configuration. |
| `timeout` | The lookup timed out | Check GitLab availability and the connect, headers and body timeouts. |
| `network` | Another transport or local request failure | Check connectivity, proxy settings and server configuration. |
| `http` | GitLab returned an error status or an unreadable response | Inspect `status`. A `401` or `403` sets `userLookup` to `rejected`; other failed lookups set it to `failed`. |

The diagnostic contains a safe message and, when known, a transport `code` or HTTP
`status`. It omits response bodies, raw exception text and headers. The same
message appears in connection-check warnings. Successful lookups keep their
existing response shape and omit `userLookupError`.

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

A `403` from the background `/user` health probe means the token cannot read the
user profile. It does not take the instance offline or disable unrelated tools.
The server logs this once per monitored instance; each operation still requires
its own GitLab permissions. A `401` from that probe still marks the connection as
failed because the token is invalid, expired, or revoked. Replace the token and
reconnect after a `401`.

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
    "GITLAB_API_HEADERS_TIMEOUT_MS": "30000",
    "GITLAB_API_BODY_TIMEOUT_MS": "60000"
  }
}
```

Defaults: connect `2000ms`, headers `10000ms`, body `30000ms`.

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

### Rate-Limited Writes

When GitLab returns HTTP 429, the MCP result has `isError: true` and a
`RATE_LIMITED` error. If GitLab supplies a valid `Retry-After` header, the error
also contains `retry_after_seconds`: the minimum wait in whole seconds, rounded
up at response receipt. The same error appears in the JSON text content and in
`structuredContent.error`.

The header can contain delay-seconds or an HTTP date, including the obsolete
HTTP-date formats required by [RFC 9110 sections 10.2.3 and 5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).
A past date or zero delay produces `0`. Missing, malformed or numerically
unrepresentable values omit the field. Other response headers are not forwarded.

The server does not automatically repeat writes, including MR comments and
discussions. The client decides whether and when to retry. Existing read retry
settings and maximum backoff remain in effect; the reported wait is not capped
by the server's read retry configuration.

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

Proxy diagnostics omit usernames and passwords while retaining the proxy host and port.
Malformed proxy URLs appear as `<invalid proxy URL>` instead of the configured value.
These log changes do not alter the proxy configuration used for connections.

### VPN or Firewall

Ensure your network allows HTTPS (port 443) connections to your GitLab instance.

## See Also

- [Configuration reference](/guide/configuration)
- [TLS/HTTPS](/advanced/tls)
- [OAuth Authentication](/security/oauth)
