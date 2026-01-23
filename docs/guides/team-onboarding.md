# Team Onboarding Guide

Get your team started with GitLab MCP — from installation to daily workflows.

## Overview

This guide helps team leads onboard developers to use GitLab MCP effectively. It covers installation, access setup, and learning the key workflows.

**Tools used:** `browse_projects`, `list_project_members`, `manage_member`, `browse_merge_requests`, `browse_pipelines`

## Step 1: Install GitLab MCP

Each team member needs to install the MCP server. The simplest method:

```bash
npx @structured-world/gitlab-mcp init
```

This interactive wizard will:
- Detect your MCP client (VS Code, Cursor, Claude Desktop, etc.)
- Configure the connection
- Set up authentication

See [Installation Guide](/guide/installation/npm) for detailed instructions per platform.

## Step 2: Configure Access

### Personal Access Token

Each developer needs a GitLab PAT with appropriate scopes:

| Scope | Purpose |
|-------|---------|
| `api` | Full API access (recommended for developers) |
| `read_api` | Read-only access (for review-only users) |
| `read_repository` | Repository file access |

Set the token:

```bash
# In your MCP client configuration
GITLAB_TOKEN=glpat-your-token-here
GITLAB_API_URL=https://gitlab.company.com/api/v4
```

### Verify Access

> "List my projects to verify the connection works"

```json
// browse_projects
{
  "action": "list",
  "membership": true,
  "per_page": 5
}
```

## Step 3: Add Team Members

As a team lead, add new members to your projects:

> "Add @new-developer as a developer to `my-org/api`"

```json
// manage_member
{
  "action": "add_to_project",
  "project_id": "my-org/api",
  "user_id": "42",
  "access_level": 30
}
```

Access levels:
- **10** — Guest (view only)
- **20** — Reporter (view + create issues)
- **30** — Developer (push code, create MRs)
- **40** — Maintainer (merge, manage settings)
- **50** — Owner (full control)

### Verify Team Roster

> "Show me all members of `my-org/api`"

```json
// list_project_members
{
  "project_id": "my-org/api",
  "per_page": 50
}
```

## Step 4: First Day Workflows

Share these prompts with new team members for their first day:

### Discover the Project

> "Show me the file structure of `my-org/api`"

> "Read the README of `my-org/api`"

> "What branches exist? Which is the main branch?"

### Understand Recent Work

> "Show me the last 10 commits in `my-org/api`"

> "What MRs were merged this week?"

> "Are there any open MRs I should know about?"

### Check CI/CD

> "What's the current pipeline status on `main`?"

> "Show me the CI/CD configuration"

## Step 5: Daily Workflow Training

### Morning Routine

Teach new team members this daily check:

1. > "Show me my todos — what needs attention?"
2. > "Are there MRs waiting for my review?"
3. > "What's the pipeline status on my branches?"

### Creating Work

1. > "Create a branch `feature/my-task` from `main`"
2. > "Create an MR from my feature branch to `main`"
3. > "Add @reviewer as reviewer on my MR"

### Reviewing Code

1. > "Show me MRs assigned to me for review"
2. > "Get the diff for MR !42"
3. > "Leave a comment on the implementation"
4. > "Approve MR !42"

See the [Complete Code Review Guide](/guides/complete-code-review) for the full workflow.

## Step 6: Project-Specific Setup

### Scope to Your Team

If your team works in a specific group:

> "Scope all my operations to the `my-org/backend` group"

```json
// manage_context
{
  "action": "set_scope",
  "namespace": "my-org/backend",
  "includeSubgroups": true
}
```

### Feature Flags

Enable only the tools your team needs:

```bash
# For a frontend team
USE_MRS=true
USE_PIPELINE=true
USE_FILES=true
USE_WORKITEMS=true
USE_LABELS=true

# Disable unused features
USE_GITLAB_WIKI=false
USE_SNIPPETS=false
USE_INTEGRATIONS=false
```

## Step 7: Best Practices

### For the Team

1. **Use clear MR descriptions** — AI tools work better with context
2. **Label consistently** — Use team-agreed label schemes
3. **Keep branches small** — Easier to review via MCP
4. **Document decisions** — Add comments explaining *why*

### For Team Leads

1. **Set up notifications** — See [CI Notifications Guide](/guides/setup-ci-notifications)
2. **Create label templates** — Standardize issue categorization
3. **Define review process** — Who reviews what, approval requirements
4. **Monitor pipeline health** — Regular status checks

## Troubleshooting

### "Permission denied"

- Check the user's access level matches required operations
- Verify the PAT scopes include necessary permissions
- Ensure the project is accessible to the user

### "Project not found"

- Verify the project path is correct (group/project format)
- Check if the project is private and user has access
- Try using the numeric project ID instead of path

### "Rate limited"

- GitLab API has rate limits per user
- Space out large batch operations
- Consider using a dedicated service account for automation

## Quick Reference Card

Share this with new team members:

| Task | Prompt |
|------|--------|
| My todos | "Show my pending todos" |
| Open MRs | "List my open MRs" |
| Create MR | "Create MR from feature/x to main" |
| Pipeline status | "Check pipeline on my branch" |
| Review MR | "Show diff for MR !42" |
| Leave comment | "Comment on MR !42 about the auth logic" |
| Approve | "Approve MR !42" |
