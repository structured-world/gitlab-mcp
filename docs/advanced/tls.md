# TLS / HTTPS Configuration

GitLab MCP Server supports secure HTTPS connections via direct TLS termination or reverse proxy.

## Quick Reference

| Approach | Best For | HTTP/2 | Auto-Renewal |
|----------|----------|--------|--------------|
| **Direct TLS** | Development, simple deployments | No | Manual |
| **Reverse Proxy** | Production (recommended) | Yes | Yes |

## Direct TLS

The server can handle TLS directly using certificate files.

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SSL_CERT_PATH` | Path to PEM certificate file | Yes |
| `SSL_KEY_PATH` | Path to PEM private key file | Yes |
| `SSL_CA_PATH` | CA certificate chain (client cert validation) | No |
| `SSL_PASSPHRASE` | Passphrase for encrypted private keys | No |

### Example with Docker

```bash
docker run -d \
  -e PORT=3000 \
  -e SSL_CERT_PATH=/certs/server.crt \
  -e SSL_KEY_PATH=/certs/server.key \
  -e GITLAB_TOKEN=your_token \
  -e GITLAB_API_URL=https://gitlab.com \
  -v $(pwd)/certs:/certs:ro \
  -p 3000:3000 \
  ghcr.io/structured-world/gitlab-mcp:latest
```

## Reverse Proxy (Recommended)

For production deployments, use a reverse proxy for TLS termination.

Benefits:
- HTTP/2 with proper ALPN negotiation
- Automatic certificate renewal (Let's Encrypt)
- Load balancing
- Centralized TLS management

### Trust Proxy Configuration

When behind a reverse proxy, set `TRUST_PROXY` to properly handle `X-Forwarded-*` headers:

| Value | Description |
|-------|-------------|
| `true` | Trust all proxies |
| `false` | Disable trust proxy |
| `loopback` | Trust loopback addresses |
| `uniquelocal` | Trust private network addresses |
| Number (e.g., `1`) | Trust nth hop from front-facing proxy |
| IP addresses | Trust specific proxy IPs |

### Caddy (Simplest)

Automatic Let's Encrypt certificates:

```
gitlab-mcp.example.com {
    reverse_proxy gitlab-mcp:3002 {
        flush_interval -1
    }
}
```

### Nginx

```nginx
upstream gitlab_mcp {
    server 127.0.0.1:3002;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name gitlab-mcp.example.com;

    ssl_certificate /etc/letsencrypt/live/gitlab-mcp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gitlab-mcp.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://gitlab_mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support (critical for MCP)
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

### Traefik

```yaml
http:
  routers:
    gitlab-mcp:
      rule: "Host(`gitlab-mcp.example.com`)"
      entryPoints: [websecure]
      service: gitlab-mcp
      tls:
        certResolver: letsencrypt
  services:
    gitlab-mcp:
      loadBalancer:
        servers:
          - url: "http://gitlab-mcp:3002"
```

## Docker Compose Examples

### With Caddy

```yaml
services:
  gitlab-mcp:
    image: ghcr.io/structured-world/gitlab-mcp:latest
    environment:
      - PORT=3002
      - HOST=0.0.0.0
      - TRUST_PROXY=true
      - GITLAB_TOKEN=${GITLAB_TOKEN}
      - GITLAB_API_URL=https://gitlab.com
    expose:
      - "3002"

  caddy:
    image: caddy:alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      - gitlab-mcp

volumes:
  caddy_data:
```

For additional proxy configurations (Envoy, Traefik with Docker labels), see [SSL.md](https://github.com/structured-world/gitlab-mcp/blob/main/SSL.md) in the repository.

## Security Best Practices

1. **Use TLS 1.2+ only** — Disable TLS 1.0 and 1.1
2. **Enable HSTS** — `Strict-Transport-Security` header
3. **Bind to localhost** when using reverse proxy — `HOST=127.0.0.1`
4. **Use Let's Encrypt** for automatic renewal
5. **Restrict file permissions** on private keys (chmod 600)
