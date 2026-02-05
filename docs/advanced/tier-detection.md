---
title: Tier Detection
description: "Understand how GitLab MCP detects namespace tier (Free/Premium/Ultimate) for feature availability. Learn about per-namespace caching, GraphQL queries, and tier-based tool restrictions."
head:
  - - meta
    - name: keywords
      content: tier detection, namespace tier, free, premium, ultimate, feature availability, MCP
---

# GitLab Tier Detection for Premium Features

How GitLab MCP detects the tier (Free/Premium/Ultimate) of each namespace to determine feature availability.

## Critical Concept

::: danger Important
**Tier is per-NAMESPACE, not per-instance!**

On gitlab.com, a single user can access Free, Premium, and Ultimate namespaces simultaneously. Detecting tier at the instance level would be incorrect.
:::

## How It Works

### GraphQL Query

GitLab MCP queries the namespace tier via GraphQL:

```graphql
query GetNamespaceTier($fullPath: ID!) {
  namespace(fullPath: $fullPath) {
    id
    fullPath

    # For groups - check plan directly
    ... on Group {
      plan
    }

    # For projects - check parent group's plan
    ... on Project {
      group {
        plan
      }
    }
  }
}
```

### Tier Normalization

GitLab plan names are normalized to three tiers:

| GitLab Plan | Normalized Tier |
|-------------|-----------------|
| `ultimate`, `gold` | Ultimate |
| `premium`, `silver`, `bronze`, `starter` | Premium |
| `free`, `null`, other | Free |

### Caching

Namespace tier is cached per-session with 5-minute TTL:

```
Session Cache Key: ${sessionId}:${namespacePath}
Example: abc123:gitlab-org → Ultimate
```

Cache is cleared when:
- TTL expires (5 minutes)
- User switches GitLab instance (static token mode)
- Session ends

## Feature Availability

Each tier enables different features:

| Feature | Free | Premium | Ultimate |
|---------|------|---------|----------|
| Issues | Yes | Yes | Yes |
| Merge Requests | Yes | Yes | Yes |
| Wiki | Yes | Yes | Yes |
| Epics | No | Yes | Yes |
| Iterations | No | Yes | Yes |
| Roadmaps | No | Yes | Yes |
| OKRs | No | No | Yes |
| Health Status | No | Yes | Yes |
| Weight | No | Yes | Yes |
| Multi-level Epics | No | Yes | Yes |
| Requirements | No | Yes | Yes |
| Security Dashboard | No | No | Yes |
| Compliance Framework | No | Yes | Yes |

### Feature Checks in Tools

Tools that require specific features check the namespace tier:

```typescript
// Example: Creating an epic
async function handleCreateEpic(args) {
  const tierInfo = await getNamespaceTier(args.groupPath);

  if (!tierInfo.features.epics) {
    throw new Error(
      `Epics require GitLab Premium or Ultimate. ` +
      `Namespace "${args.groupPath}" is on ${tierInfo.tier} tier.`
    );
  }

  // Proceed with epic creation...
}
```

### Error Messages

When a feature is unavailable, users receive helpful error messages:

```
Error: Epics require GitLab Premium or Ultimate.
Namespace "my-free-group" is on free tier.

Consider:
- Upgrade the namespace to Premium or Ultimate
- Use a different namespace with higher tier
```

## SaaS vs Self-Hosted

### GitLab.com (SaaS)

- Each namespace can have a different tier
- Tier detection via GraphQL is required
- Same user may access Free/Premium/Ultimate namespaces

### Self-Hosted

- Typically has a single license for the entire instance
- All namespaces share the same tier
- Tier can be cached at instance level (optimization)

GitLab MCP detects SaaS vs self-hosted and optimizes accordingly.

## API Functions

### getNamespaceTier

```typescript
async function getNamespaceTier(
  namespacePath: string
): Promise<NamespaceTierInfo>

interface NamespaceTierInfo {
  tier: 'free' | 'premium' | 'ultimate';
  features: Record<string, boolean>;
  cachedAt: Date;
}
```

### isFeatureAvailable

```typescript
async function isFeatureAvailable(
  namespacePath: string,
  feature: string
): Promise<boolean>

// Example usage
const canCreateEpic = await isFeatureAvailable('my-group', 'epics');
```

### clearNamespaceTierCache

```typescript
function clearNamespaceTierCache(sessionId?: string): void

// Clear for specific session
clearNamespaceTierCache('abc123');

// Clear all caches
clearNamespaceTierCache();
```

## Troubleshooting

### Feature unavailable error

If you receive a feature unavailability error:

1. Check the namespace path is correct
2. Verify the namespace has the required tier in GitLab UI
3. Wait 5 minutes for cache to expire if tier was recently upgraded

### Tier not detected correctly

If tier detection seems incorrect:

1. Check GitLab API access - token must have `api` or `read_api` scope
2. Verify the namespace exists and is accessible
3. Check for GraphQL errors in server logs

## Related Documentation

- [Multi-Instance Setup](/guide/multi-instance) - Getting started guide
- [Federation Architecture](/advanced/federation) - Technical deep dive
- [Context Switching](/advanced/context-switching) - Instance switching behavior
