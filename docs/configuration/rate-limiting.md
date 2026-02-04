---
title: Rate Limiting
description: "Configure per-instance rate limiting for GitLab MCP Server"
head:
  - - meta
    - name: keywords
      content: rate limiting, concurrent requests, queue, throttling, MCP
---

# Rate Limiting

Configure per-instance rate limiting to prevent overwhelming GitLab instances with too many concurrent requests.

## Overview

GitLab MCP implements per-instance rate limiting to:
- Prevent hitting GitLab API rate limits
- Ensure fair resource usage in multi-user environments
- Protect self-hosted instances from overload

## Configuration

### Per-Instance Settings

```yaml
instances:
  - url: https://gitlab.com
    rateLimit:
      maxConcurrent: 100    # Max parallel requests
      queueSize: 500        # Max queued requests
      queueTimeout: 60000   # Queue wait timeout (ms)

  - url: https://git.company.io
    rateLimit:
      maxConcurrent: 50     # Lower for self-hosted
      queueSize: 200
      queueTimeout: 30000
```

### Global Defaults

```yaml
defaults:
  rateLimit:
    maxConcurrent: 100
    queueSize: 500
    queueTimeout: 60000
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxConcurrent` | 100 | Maximum number of simultaneous requests to the instance |
| `queueSize` | 500 | Maximum number of requests waiting in queue |
| `queueTimeout` | 60000 | Time (ms) a request can wait in queue before timing out |

## How It Works

```
Request arrives
      │
      ▼
┌─────────────────┐
│ Under capacity? │──Yes──▶ Execute immediately
│ (< maxConcurrent│
└─────────────────┘
      │ No
      ▼
┌─────────────────┐
│ Queue not full? │──Yes──▶ Add to queue, wait
│ (< queueSize)   │
└─────────────────┘
      │ No
      ▼
   Reject with
   rate limit error
```

### Request Lifecycle

1. **Under capacity**: Execute immediately
2. **At capacity, queue space**: Add to queue, wait for slot
3. **Queue full**: Reject immediately with error
4. **Queue timeout**: Reject after timeout period

### Slot Release

When a request completes (success or failure):
1. Release the slot
2. If queue is not empty, promote next request

## Recommended Settings

### GitLab.com (SaaS)

```yaml
rateLimit:
  maxConcurrent: 100
  queueSize: 500
  queueTimeout: 60000
```

GitLab.com can handle high concurrency but has its own rate limits (2000 requests/minute for authenticated users).

### Self-Hosted (Production)

```yaml
rateLimit:
  maxConcurrent: 50
  queueSize: 200
  queueTimeout: 30000
```

More conservative to protect server resources.

### Self-Hosted (Small Instance)

```yaml
rateLimit:
  maxConcurrent: 20
  queueSize: 100
  queueTimeout: 30000
```

For smaller instances with limited resources.

### Development/Testing

```yaml
rateLimit:
  maxConcurrent: 10
  queueSize: 50
  queueTimeout: 10000
```

Lower limits for development to catch issues early.

## Monitoring

### Metrics

GitLab MCP exposes rate limiting metrics per instance:

```typescript
interface RateLimitMetrics {
  instanceUrl: string;
  activeRequests: number;      // Currently executing
  maxConcurrent: number;       // Configured max
  queuedRequests: number;      // Currently queued
  queueSize: number;           // Configured max queue
  requestsTotal: number;       // Total requests processed
  requestsRejected: number;    // Rejected due to limits
  avgQueueWaitMs: number;      // Average queue wait time
}
```

### CLI Info Command

View rate limit status:

```bash
npx @structured-world/gitlab-mcp instances info https://gitlab.com
```

Output includes:
```
Rate Limit Metrics:
  Active Requests: 15/100
  Queued: 0/500
  Total Requests: 1234
  Rejected: 0
  Avg Queue Wait: 0ms
```

## Error Handling

### Queue Full Error

```
Error: Rate limit exceeded: 100 active, 500 queued (max: 500)
```

This means:
- All concurrent slots are in use
- Queue is at capacity
- Request cannot be accepted

**Solutions:**
- Wait and retry
- Increase `queueSize` if this is common
- Check for stuck requests

### Queue Timeout Error

```
Error: Request queued for 60000ms, timing out
```

This means:
- Request waited in queue for `queueTimeout` ms
- Slot never became available

**Solutions:**
- Increase `maxConcurrent` if instance can handle more
- Increase `queueTimeout` for longer operations
- Check for slow or stuck requests

## Best Practices

### Match Instance Capacity

- For GitLab.com: Higher limits are usually fine
- For self-hosted: Match to your server's capacity
- Monitor and adjust based on actual usage

### Consider Multi-User Scenarios

In multi-user environments (OAuth mode):
- Limits are per-instance, not per-user
- 10 users × 10 concurrent = 100 instance-wide
- Set limits accordingly

### Queue Timeout vs Operation Timeout

- `queueTimeout`: How long to wait for a slot
- `GITLAB_API_TIMEOUT_MS`: How long to wait for API response

Both can cause timeouts, but for different reasons.

### Graceful Degradation

When approaching limits:
1. Queue starts filling up
2. Response times increase
3. Eventually requests are rejected

Monitor queue depth to catch issues before rejection.

## Related Documentation

- [Instance Configuration](/configuration/instances) - Full configuration reference
- [Multi-Instance Setup](/guide/multi-instance) - Getting started guide
- [Federation Architecture](/advanced/federation) - Technical deep dive
