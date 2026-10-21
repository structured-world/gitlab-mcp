---
title: Federation Architecture
description: "Technical deep dive into GitLab MCP federation architecture. Learn about multi-instance management, caching strategies, rate limiting, HTTP/2 connection pooling, and session isolation."
head:
  - - meta
    - name: keywords
      content: federation, architecture, multi-instance, caching, rate limiting, MCP
---

# Federation Architecture

Technical deep dive into how GitLab MCP manages multiple GitLab instances with proper caching, rate limiting, and session isolation.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (single process)              │
├─────────────────────────────────────────────────────────────┤
│  InstanceRegistry (Singleton)                               │
│  ┌─────────────┬─────────────┬─────────────┐               │
│  │ gitlab.com  │ git.corp.io │ gl.dev.net  │               │
│  │ OAuth App 1 │ OAuth App 2 │ OAuth App 3 │               │
│  │ Schema ✓    │ Schema ✓    │ Schema (?)  │               │
│  │ v17.2 SaaS  │ v16.8 Self  │ v16.0 Self  │               │
│  │ Rate: 0/100 │ Rate: 5/50  │ Rate: 2/20  │               │
│  └─────────────┴─────────────┴─────────────┘               │
│  NOTE: No tier here! Tier is per-namespace, not instance   │
├─────────────────────────────────────────────────────────────┤
│  SessionManager (per-user sessions)                         │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ User A           │  │ User B           │                │
│  │ → gitlab.com     │  │ → git.corp.io    │                │
│  │ Token: xxx       │  │ Token: yyy       │                │
│  │ Scopes: [api]    │  │ Scopes: [api]    │                │
│  │ NS Cache:        │  │ NS Cache:        │                │
│  │  grp1→Ultimate   │  │  corp→Premium    │                │
│  │  grp2→Free       │  │                  │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

## Caching Strategy

### Cache Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    CACHING LAYERS                               │
├─────────────────────────────────────────────────────────────────┤
│ INSTANCE-LEVEL CACHE (InstanceRegistry) — TTL: 10 min          │
│ Safe to share between all users of same instance               │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ • GitLab version (e.g., 17.2.0)                             ││
│ │ • GraphQL schema (available types, widgets, mutations)      ││
│ │ • Instance type: SaaS (gitlab.com) vs Self-hosted           ││
│ │ • Self-hosted only: instance-wide tier (if single license)  ││
│ └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│ SESSION-LEVEL CACHE (OAuthSession) — TTL: session lifetime     │
│ Per-user, not shared                                           │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ • Token scopes (api, read_api, read_user, etc.)             ││
│ │ • User info (username, id)                                  ││
│ └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│ NAMESPACE-LEVEL CACHE (per session) — TTL: 5 min               │
│ Tier varies per group/project, especially on gitlab.com        │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ "gitlab-org" → Ultimate, features: {epics: ✓, iterations: ✓}││
│ │ "my-free-group" → Free, features: {epics: ✗, iterations: ✗} ││
│ │ "company/proj" → Premium, features: {epics: ✓, ...}         ││
│ └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Why Tier is NOT Instance-Level

On gitlab.com (SaaS), a single user can access namespaces with different tiers:

| Namespace | Tier | Epics | Iterations |
|-----------|------|-------|------------|
| `my-personal` | Free | No | No |
| `work-team` | Premium | Yes | Yes |
| `enterprise-client` | Ultimate | Yes | Yes |

Caching tier at the instance level would incorrectly assume all namespaces share the same tier.

## Components

### InstanceRegistry

Singleton managing all registered GitLab instances:

```typescript
interface GitLabInstance {
  url: string;
  label?: string;
  oauth?: {
    clientId: string;
    clientSecret?: string;
    scopes?: string;
  };
  rateLimit?: RateLimitConfig;
  introspection?: InstanceIntrospection;
  connectionStatus: 'healthy' | 'degraded' | 'offline';
}
```

Responsibilities:
- Instance registration and lookup
- Instance-level introspection caching (version, schema)
- Rate limiter management per instance
- Connection health tracking

### InstanceConnectionPool

Per-instance HTTP/2 connection pooling:

```typescript
class InstanceConnectionPool {
  // Get or create GraphQL client for an instance
  getGraphQLClient(
    instanceConfig: GitLabInstanceConfig,
    authHeaders?: Record<string, string>
  ): GraphQLClient;

  // Get Undici pool dispatcher for enhancedFetch
  getDispatcher(baseUrl: string): UndiciPool | undefined;
}
```

Features:
- Undici Pool with HTTP/2 multiplexing and keepalive
- Per-instance TLS configuration (insecureSkipVerify)
- Connection reuse across requests (30s keepalive, 5min max)
- Pool statistics for monitoring (connected, free, pending, running)

Integration with `enhancedFetch`:
```typescript
// In enhancedFetch(), per-instance dispatcher is obtained and passed to doFetch
const instanceDispatcher = registry.getDispatcher(baseUrl);
await doFetch(url, options, instanceDispatcher);
```

### InstanceRateLimiter

Per-instance concurrent request limiting:

```typescript
class InstanceRateLimiter {
  constructor(
    maxConcurrent: number,    // Max parallel requests
    queueSize: number,        // Max queued requests
    queueTimeout: number      // Queue wait timeout (ms)
  );

  async acquire(): Promise<() => void>;  // Returns release function
}
```

Request flow:
1. If under `maxConcurrent`: execute immediately
2. If at capacity but queue not full: add to queue
3. If queue full: reject with error
4. On completion: release slot, process queued requests

### NamespaceTierDetector

Detects and caches namespace tier via GraphQL:

```graphql
query GetNamespaceTier($fullPath: ID!) {
  namespace(fullPath: $fullPath) {
    id
    fullPath

    ... on Group {
      plan
    }

    ... on Project {
      group {
        plan
      }
    }
  }
}
```

Tier normalization:
- `ultimate`, `gold` → Ultimate
- `premium`, `silver`, `bronze`, `starter` → Premium
- Everything else → Free

### TokenContext

Extended to carry instance URL per request:

```typescript
interface TokenContextData {
  sessionId: string;
  gitlabToken: string;
  apiUrl?: string;      // GitLab instance URL
  instanceLabel?: string;
}
```

The `apiUrl` is used by `enhancedFetch` to route requests to the correct instance.

## Request Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   MCP Tool   │────▶│ enhancedFetch│────▶│  Rate Limit  │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                     │
                            ▼                     ▼
                     ┌──────────────┐     ┌──────────────┐
                     │ TokenContext │     │   Instance   │
                     │   (apiUrl)   │     │   Registry   │
                     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │  Connection  │
                                          │     Pool     │
                                          │   (HTTP/2)   │
                                          └──────────────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │   GitLab     │
                                          │     API      │
                                          └──────────────┘
```

1. Tool calls `enhancedFetch()`
2. `TokenContext` provides `apiUrl` for the current session
3. `InstanceRegistry` provides rate limiter and HTTP/2 dispatcher for that instance
4. `InstanceConnectionPool` provides per-instance Undici Pool with keepalive
5. Request is executed with connection reuse and multiplexing
6. Response flows back through the chain

## Session Isolation

Each OAuth session is isolated:
- Holds the account it signed in with and the accounts linked to it, each with its own tokens and instance
- Has its own namespace tier cache
- Never reaches the accounts of another session

Each chat of a session works with one of its accounts; a call runs with that account's token on its instance. A static-token server works with its own instance and the configured instances that name a token. See [Context Switching](/advanced/context-switching).

## Schema Differences

Different GitLab versions have different GraphQL schemas. For each instance the server:

1. Detects the version and caches the schema
2. Checks each tool, action and parameter against its declared minimum version and the schema
3. Falls back to an older equivalent where one exists
4. Hides only what the instance cannot do, and refuses it if called

Example: on GitLab 16.0 to 16.3 the work item actions `add_link` and `remove_link` are hidden; every other work item action works.

## Related Documentation

- [Multi-Instance Setup](/guide/multi-instance) - Getting started guide
- [Tier Detection](/advanced/tier-detection) - Namespace tier detection
- [Context Switching](/advanced/context-switching) - Which instance a connection uses
- [Configuration Reference](/configuration/instances) - Configuration options
