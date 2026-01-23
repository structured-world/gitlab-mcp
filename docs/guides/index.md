# Step-by-Step Guides

Comprehensive walkthroughs for common GitLab MCP workflows.

## Available Guides

| Guide | Description | Key Tools |
|-------|-------------|-----------|
| [Complete Code Review](/guides/complete-code-review) | End-to-end MR review process | browse_merge_requests, manage_mr_discussion |
| [Setup CI Notifications](/guides/setup-ci-notifications) | Pipeline alerts via Slack/Discord/webhooks | manage_webhook, manage_integration |
| [Automate Releases](/guides/automate-releases) | Release workflow with changelogs | manage_release, browse_commits |
| [Multi-GitLab Setup](/guides/multi-gitlab-setup) | Multiple instances with presets | manage_context |
| [Team Onboarding](/guides/team-onboarding) | Getting your team started | browse_projects, manage_member |

## How to Use These Guides

Each guide provides:

1. **Overview** — What you'll accomplish and which tools are used
2. **Step-by-step instructions** — Sequential workflow with example prompts
3. **JSON examples** — Exact tool parameters for each step
4. **Tips and troubleshooting** — Common issues and best practices

## Quick Links by Task

### Setting Things Up
- [Install GitLab MCP](/guide/quick-start) — First-time setup
- [Configure access](/guides/team-onboarding#step-2-configure-access) — Tokens and permissions
- [Set up notifications](/guides/setup-ci-notifications) — Alerts for your team

### Daily Work
- [Review code](/guides/complete-code-review) — Full review process
- [Debug CI failures](/prompts/ci-cd/debug-failure) — Fix broken pipelines
- [Manage sprints](/prompts/project-management/sprint-planning) — Milestone tracking

### Administration
- [Manage team members](/guides/team-onboarding#step-3-add-team-members) — Access control
- [Multi-instance config](/guides/multi-gitlab-setup) — Enterprise setups
- [Branch protection](/prompts/by-role/devops#branch-protection) — Security policies
