---
title: Automate Releases
description: "Automate GitLab release workflows with MCP Server. Step-by-step guide for changelog generation, tag creation, release publishing with assets, milestone association, and version management."
head:
  - - meta
    - name: keywords
      content: GitLab releases, release automation, changelog, tagging, milestones, release assets, MCP
---

# Automate GitLab Releases with MCP

End-to-end release workflow — from reviewing changes to creating releases with changelogs and assets.

## Overview

This guide walks through a complete release process using GitLab MCP: reviewing merged changes, creating tags, generating changelogs, and publishing releases with assets.

**Tools used:** `browse_commits`, `browse_merge_requests`, `manage_release`, `browse_releases`, `manage_ref`, `browse_milestones`, `manage_milestone`

## Step 1: Review Changes Since Last Release

Start by identifying what's changed since the previous release.

### Find the Last Release

> "Show me the latest releases in `my-org/api`"

```jsonc
// browse_releases
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 1
}
```

### List Commits Since Last Tag

> "Show me commits on `main` since the last release"

```jsonc
// browse_commits
{
  "action": "list",
  "project_id": "my-org/api",
  "ref_name": "main",
  "since": "2025-01-15T00:00:00Z",
  "per_page": 50
}
```

### Review Merged MRs

> "What MRs were merged since the last release?"

```jsonc
// browse_merge_requests
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "merged",
  "target_branch": "main",
  "updated_after": "2025-01-15T00:00:00Z",
  "order_by": "updated_at",
  "per_page": 50
}
```

## Step 2: Check Milestone Completion

Verify all milestone work is done before releasing.

> "Show me the issues and MRs in milestone 'v2.0'"

::: code-group

```jsonc [Milestone issues]
{
  "action": "issues",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 50
}
```

```jsonc [Milestone MRs]
{
  "action": "merge_requests",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "per_page": 50
}
```

:::

Check for open items that might block the release. If all work is complete, proceed.

## Step 3: Verify Pipeline Status

Ensure `main` is green before tagging.

> "What's the pipeline status on `main`?"

```jsonc
// browse_pipelines
{
  "action": "list",
  "project_id": "my-org/api",
  "ref": "main",
  "per_page": 1
}
```

If the latest pipeline failed, fix issues before proceeding.

## Step 4: Create a Tag

> "Create tag v2.0.0 from `main` in `my-org/api`"

```jsonc
// manage_ref
{
  "action": "create_tag",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "ref": "main",
  "message": "Release v2.0.0 - Platform modernization"
}
```

## Step 5: Generate Changelog

Based on the merged MRs, organize changes by category:

- **Features** — MRs with `feat:` prefix or `feature` label
- **Bug Fixes** — MRs with `fix:` prefix or `bug` label
- **Breaking Changes** — MRs with `breaking` label
- **Performance** — MRs with `perf:` prefix
- **Dependencies** — MRs updating packages

## Step 6: Create the Release

> "Create release v2.0.0 with changelog and milestone association"

```jsonc
// manage_release
{
  "action": "create",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "v2.0.0 - Platform Modernization",
  "description": "## What's New\n\n### Features\n- New authentication flow with JWT (#42)\n- API rate limiting with configurable thresholds (#45)\n- WebSocket support for real-time updates (#48)\n\n### Bug Fixes\n- Fixed session timeout regression (#38)\n- Corrected error messages for validation failures (#40)\n- Fixed memory leak in connection pool (#41)\n\n### Breaking Changes\n- Removed deprecated `/auth/legacy` endpoint\n- Changed response format for `/api/v2/users` endpoint\n\n### Performance\n- 40% faster query processing with new indexes (#44)\n- Reduced memory usage in background workers (#46)\n\n### Dependencies\n- Updated Express to v5.0\n- Updated TypeScript to v5.4",
  "milestones": ["v2.0"]
}
```

## Step 7: Add Release Assets

> "Add download links to the release"

::: code-group

```jsonc [Linux binary]
{
  "action": "create_link",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "Linux AMD64",
  "url": "https://releases.example.com/api/v2.0.0/api-linux-amd64",
  "link_type": "package",
  "direct_asset_path": "/binaries/api-linux-amd64"
}
```

```jsonc [Docker image]
{
  "action": "create_link",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "Docker Image",
  "url": "https://registry.example.com/my-org/api:v2.0.0",
  "link_type": "image"
}
```

```jsonc [Runbook]
{
  "action": "create_link",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "Deployment Runbook",
  "url": "https://wiki.example.com/deploy/v2.0.0",
  "link_type": "runbook"
}
```

:::

## Step 8: Close the Milestone

> "Close milestone 'v2.0' — all work is released"

```jsonc
// manage_milestone
{
  "action": "update",
  "namespace": "my-org/api",
  "milestone_id": "42",
  "state_event": "close"
}
```

## Step 9: Prepare Next Iteration

> "Create milestone 'v2.1' for the next sprint"

```jsonc
// manage_milestone
{
  "action": "create",
  "namespace": "my-org/api",
  "title": "v2.1",
  "description": "Post-v2.0 improvements and fixes",
  "start_date": "2025-02-03",
  "due_date": "2025-02-28"
}
```

## Complete Release Checklist

- [ ] All milestone issues/MRs closed
- [ ] Pipeline green on `main`
- [ ] Changelog generated from merged MRs
- [ ] Tag created from `main`
- [ ] Release created with description
- [ ] Assets attached (binaries, Docker, docs)
- [ ] Milestone closed
- [ ] Next milestone created
- [ ] Team notified of release

## Tips for Release Automation

1. **Use Conventional Commits** — Makes changelog generation predictable
2. **Label MRs consistently** — `feature`, `bug`, `breaking` for categorization
3. **Associate MRs with milestones** — Easy to track what's in each release
4. **Tag before releasing** — Ensures the tag exists for the release
5. **Close milestones promptly** — Keeps the roadmap clean
