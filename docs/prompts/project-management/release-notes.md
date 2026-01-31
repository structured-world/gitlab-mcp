---
title: Release Notes
description: "Prompts for generating release notes from GitLab — summarize MRs, issues, and changelog entries"
head:
  - - meta
    - name: keywords
      content: gitlab release notes, changelog generation, create release, release assets, milestone release, version tagging
---

# Release Notes

Generate changelogs, create releases, and manage release assets.

## Review Changes Since Last Release

> "Show me commits since the last tag in `my-org/api`"

> "What MRs were merged since v1.5.0?"

::: code-group

```json [Commits since tag]
{
  "action": "list",
  "project_id": "my-org/api",
  "ref_name": "main",
  "since": "2025-01-15T00:00:00Z",
  "per_page": 50
}
```

```json [Merged MRs]
{
  "action": "list",
  "project_id": "my-org/api",
  "state": "merged",
  "updated_after": "2025-01-15T00:00:00Z",
  "per_page": 50
}
```

:::

## View Existing Releases

> "Show me the latest releases in `my-org/api`"

> "Get details of release v1.5.0"

::: code-group

```json [List releases]
{
  "action": "list",
  "project_id": "my-org/api",
  "per_page": 10
}
```

```json [Get release]
{
  "action": "get",
  "project_id": "my-org/api",
  "tag_name": "v1.5.0"
}
```

:::

## Create a Release

> "Create release v2.0.0 for `my-org/api` with a changelog"

> "Tag the current main as v1.6.0 and create a release"

::: code-group

```json [With existing tag]
{
  "action": "create",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "v2.0.0",
  "description": "## What's New\n\n### Features\n- New authentication flow (#42)\n- API rate limiting (#45)\n\n### Bug Fixes\n- Fixed session timeout (#38)\n- Corrected error messages (#40)\n\n### Breaking Changes\n- Removed deprecated `/auth/legacy` endpoint"
}
```

```json [Create tag + release]
{
  "action": "create",
  "project_id": "my-org/api",
  "tag_name": "v1.6.0",
  "name": "v1.6.0",
  "ref": "main",
  "description": "## Changes\n\n- Performance improvements\n- Dependency updates"
}
```

:::

## Add Release Assets

> "Add a download link to release v2.0.0"

```json [Add asset link]
{
  "action": "create_link",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "Linux AMD64 Binary",
  "url": "https://example.com/releases/v2.0.0/app-linux-amd64",
  "link_type": "package",
  "direct_asset_path": "/binaries/linux-amd64"
}
```

## Associate Milestones

> "Create a release linked to milestone 'v2.0'"

```json [With milestones]
{
  "action": "create",
  "project_id": "my-org/api",
  "tag_name": "v2.0.0",
  "name": "v2.0.0",
  "description": "Release for milestone v2.0",
  "milestones": ["v2.0"]
}
```

## Release Workflow

Complete release process:

1. > "Show me all MRs merged since the last release tag"
2. > "List issues closed in milestone 'v2.0'"
3. > "Create a tag v2.0.0 from `main`"
4. > "Create a release with changelog based on the merged MRs"
5. > "Close milestone 'v2.0'"
6. > "Create new milestone 'v2.1' for next sprint"

## Changelog Format Tips

Organize your changelog by category:
- **Features** — New functionality
- **Bug Fixes** — Resolved issues
- **Performance** — Speed/efficiency improvements
- **Breaking Changes** — Changes requiring user action
- **Dependencies** — Updated packages

## Next Steps

- [Sprint Planning](/prompts/project-management/sprint-planning) — Plan the next iteration
- [Issue Triage](/prompts/project-management/issue-triage) — Manage incoming issues
