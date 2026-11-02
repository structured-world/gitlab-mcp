---
title: Tier Detection
description: "How GitLab MCP combines namespace subscriptions, GitLab versions and permissions when exposing tools and fields."
head:
  - - meta
    - name: keywords
      content: tier detection, namespace tier, free, premium, ultimate, feature availability, MCP
---

# GitLab Tier Detection

On GitLab.com, subscriptions belong to **root namespaces**. One account can work
with a Free personal namespace, a Premium organization and an Ultimate customer
at the same time. A subgroup or project inherits its root namespace's subscription.
See [GitLab subscription management](https://docs.gitlab.com/subscriptions/manage_subscription/).

Self-managed GitLab uses its instance license. Namespace subscription detection
does not replace that existing instance-level path.

::: info Available from 13.2.0
Namespace observations are applied to tool discovery, action requirements and
Work Item widget checks from 13.2.0. Earlier versions use instance-level capability
data for these checks.
:::

## What the client sees

With a selected project or group, the advertised tools and fields use that
namespace's observed subscription. A scope covering several roots advertises
their union, so a Free project does not hide tools needed by an Ultimate project.

Execution resolves the actual project or group arguments again. Parallel requests
use separate contexts, including when two chats share the same GitLab.com account.
They do not change a shared connection's tier.

An unscoped request, an opaque ID that cannot yet be resolved, or a call spanning
different subscriptions has **unknown** tier. Unknown does not mean Free:
discovery does not hide paid features solely because billing metadata is missing.
GitLab still checks the actual operation's license, permissions and feature flags.

Version requirements, token scopes, admin elevation, read-only settings and
operator project restrictions remain independent checks.

## Subscription lookup

The server reads the root entity through REST API v4:

```http
GET /api/v4/namespaces/example-team
```

A numeric project ID is first resolved through `GET /projects/:id`; a numeric
group ID through `GET /groups/:id?with_projects=false`. Numeric namespace
arguments that accept either kind follow the handler's group-first resolution
and try a project only after a group 404.

The `plan` attribute is permission-dependent. Access to a project does not
guarantee access to its root's billing metadata. Missing attributes, an unknown
plan, inaccessible metadata and lookup failures leave the subscription unknown.
A lookup failure does not turn an otherwise usable GitLab operation into a
license refusal.

See the [GitLab Namespaces API](https://docs.gitlab.com/api/namespaces/) for
visibility rules. The endpoint and conditional plan attribute already exist in
the [GitLab 16.0 namespace entity](https://gitlab.com/gitlab-org/gitlab/-/blob/v16.0.0-ee/ee/lib/ee/api/entities/namespace.rb).

| Observed plan | Tier |
| --- | --- |
| `free`, `default` | Free |
| `premium`, `premium_trial`, `silver` | Premium |
| `ultimate`, `ultimate_trial`, `gold`, `opensource` | Ultimate |
| Missing, unrecognized or legacy plan without a supported equivalent | Unknown |

A plan is an input to capability checks, not proof that every feature is enabled.
Individual tools declare their version and tier requirements; widget checks use
the same request-local tier. GitLab's response remains authoritative.

## Caching and request cost

Observations, including unknown results, have a five-minute TTL. Cache keys
separate the selected instance, credential, session and root namespace.
Replacing a token or changing account cannot reuse another credential's facts.
The disposable process-local cache has a total capacity of 1,024 entries; it
contains no stored token values.

Descendants of one root share a lookup. A catalog spanning several roots resolves
at most five distinct targets concurrently and stops starting queued optional
reads after an unknown observation prevents a complete tier decision. Free-only
tool calls do not perform subscription lookups.

This cache is an optimization, not session or authorization storage. Each server
replica can rebuild its own observations. Refreshing facts never changes another
request's active tier, and an expired request cannot start a tool after a late
metadata response.

## Troubleshooting

- Confirm the selected account and project or group in `get_context`.
- Check the namespace subscription in GitLab. A user who can read a project may
  still be unable to read its billing metadata.
- If a subscription recently changed, allow up to five minutes for cached facts
  to expire.
- An explicit unavailable-action error can also be caused by the GitLab version,
  token permissions or a disabled feature. Changing a subscription alone does
  not remove those restrictions.
- Inspect logs for metadata status or read failures. Provider response bodies and
  parser exception text are excluded from these diagnostics.

## Related Documentation

- [Multi-Instance Setup](/guide/multi-instance)
- [Federation Architecture](/advanced/federation)
- [Context Switching](/advanced/context-switching)
