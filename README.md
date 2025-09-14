# GitLab MCP Server

**Maintained by:** [Dmitry Prudnikov](https://github.com/polaz) | **Original Author:** [zereight](https://github.com/zereight)

## @structured-world/mcp-gitlab

A fork of the original [@structured-world/mcp-gitlab]

![npm version](https://img.shields.io/npm/v/@structured-world/gitlab-mcp)
![npm downloads](https://img.shields.io/npm/dm/@structured-world/gitlab-mcp)
![Release](https://github.com/structured-world/gitlab-mcp/workflows/Release/badge.svg)
![Codecov](https://codecov.io/gh/structured-world/gitlab-mcp/branch/main/graph/badge.svg)
[![Coverage Report](https://img.shields.io/badge/Coverage-Live%20Report-brightgreen?logo=github)](https://structured-world.github.io/gitlab-mcp/coverage/)

GitLab MCP(Model Context Protocol) Server. **Includes bug fixes and improvements over the original GitLab MCP server.**

This fork is actively maintained and enhanced with strict TypeScript standards, Yarn 4 support, and improved development workflows.

## Usage

### Using with Claude App, Cline, Roo Code, Cursor, Kilo Code

When using with the Claude App, you need to set up your API key and URLs directly.

#### npx

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/mcp-gitlab"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "your_gitlab_api_url",
        "GITLAB_PROJECT_ID": "your_project_id", // Optional: default project
        "GITLAB_ALLOWED_PROJECT_IDS": "", // Optional: comma-separated list of allowed project IDs
        "GITLAB_READ_ONLY_MODE": "false",
        "USE_GITLAB_WIKI": "false", // use wiki api?
        "USE_MILESTONE": "false", // use milestone api?
        "USE_PIPELINE": "false" // use pipeline api?
      }
    }
  }
}
```

#### vscode .vscode/mcp.json

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "gitlab-token",
      "description": "Gitlab Token to read API",
      "password": true
    }
  ],
  "servers": {
    "GitLab-MCP": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@structured-world/mcp-gitlab"],
      "env": {
        "GITLAB_TOKEN": "${input:gitlab-token}",
        "GITLAB_API_URL": "your-fancy-gitlab-url",
        "GITLAB_READ_ONLY_MODE": "true",
        ...
      }
    }
  }
}
```

#### Docker

- stdio mcp.json

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITLAB_TOKEN",
        "-e",
        "GITLAB_API_URL",
        "-e",
        "GITLAB_READ_ONLY_MODE",
        "-e",
        "USE_GITLAB_WIKI",
        "-e",
        "USE_MILESTONE",
        "-e",
        "USE_PIPELINE",
        "ghcr.io/structured-world/mcp-gitlab:latest"
      ],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com/api/v4", // Optional, for self-hosted GitLab
        "GITLAB_READ_ONLY_MODE": "false",
        "USE_GITLAB_WIKI": "true",
        "USE_MILESTONE": "true",
        "USE_PIPELINE": "true"
      }
    }
  }
}
```

- sse

```shell
docker run -i --rm \
  -e GITLAB_TOKEN=your_gitlab_token \
  -e GITLAB_API_URL="https://gitlab.com/api/v4" \
  -e GITLAB_READ_ONLY_MODE=true \
  -e USE_GITLAB_WIKI=true \
  -e USE_MILESTONE=true \
  -e USE_PIPELINE=true \
  -e SSE=true \
  -p 3333:3002 \
  ghcr.io/structured-world/mcp-gitlab:latest
```

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "sse",
      "url": "http://localhost:3333/sse"
    }
  }
}
```

- streamable-http

```shell
docker run -i --rm \
  -e GITLAB_TOKEN=your_gitlab_token \
  -e GITLAB_API_URL="https://gitlab.com/api/v4" \
  -e GITLAB_READ_ONLY_MODE=true \
  -e USE_GITLAB_WIKI=true \
  -e USE_MILESTONE=true \
  -e USE_PIPELINE=true \
  -e STREAMABLE_HTTP=true \
  -p 3333:3002 \
  ghcr.io/structured-world/mcp-gitlab:latest
```

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "streamable-http",
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

### Environment Variables

- `GITLAB_TOKEN`: Your GitLab personal access token.
- `GITLAB_API_URL`: Your GitLab API URL. (Default: `https://gitlab.com/api/v4`)
- `GITLAB_PROJECT_ID`: Default project ID. If set, Overwrite this value when making an API request.
- `GITLAB_ALLOWED_PROJECT_IDS`: Optional comma-separated list of allowed project IDs. When set with a single value, acts as a default project (like the old "lock" mode). When set with multiple values, restricts access to only those projects. Examples:
  - Single value `123`: MCP server can only access project 123 and uses it as default
  - Multiple values `123,456,789`: MCP server can access projects 123, 456, and 789 but requires explicit project ID in requests
- `GITLAB_READ_ONLY_MODE`: When set to 'true', restricts the server to only expose read-only operations. Useful for enhanced security or when write access is not needed. Also useful for using with Cursor and it's 40 tool limit.
- `GITLAB_DENIED_TOOLS_REGEX`: When set as a regular expression, it excludes the matching tools.
- `USE_GITLAB_WIKI`: When set to 'true', enables the wiki-related tools (list_wiki_pages, get_wiki_page, create_wiki_page, update_wiki_page, delete_wiki_page). By default, wiki features are disabled.
- `USE_MILESTONE`: When set to 'true', enables the milestone-related tools (list_milestones, get_milestone, create_milestone, edit_milestone, delete_milestone, get_milestone_issue, get_milestone_merge_requests, promote_milestone, get_milestone_burndown_events). By default, milestone features are disabled.
- `USE_PIPELINE`: When set to 'true', enables the pipeline-related tools (list_pipelines, get_pipeline, list_pipeline_jobs, list_pipeline_trigger_jobs, get_pipeline_job, get_pipeline_job_output, create_pipeline, retry_pipeline, cancel_pipeline, play_pipeline_job, retry_pipeline_job, cancel_pipeline_job). By default, pipeline features are disabled.
- `GITLAB_AUTH_COOKIE_PATH`: Path to an authentication cookie file for GitLab instances that require cookie-based authentication. When provided, the cookie will be included in all GitLab API requests.
- `SSE`: When set to 'true', enables the Server-Sent Events transport.
- `STREAMABLE_HTTP`: When set to 'true', enables the Streamable HTTP transport. If both **SSE** and **STREAMABLE_HTTP** are set to 'true', the server will prioritize Streamable HTTP over SSE transport.

## Tools 🛠️

<details>
<summary>Click to expand</summary>

<!-- TOOLS-START -->

### Core Repository & Project Management
1. `create_repository` - Create a new GitLab project
2. `search_repositories` - Search for GitLab projects
3. `fork_repository` - Fork a GitLab project to your account or specified namespace
4. `get_project` - Get details of a specific project
5. `list_projects` - List projects accessible by the current user
6. `list_project_members` - List members of a GitLab project
7. `list_group_projects` - List projects in a GitLab group with filtering options
8. `get_repository_tree` - Get the repository tree for a GitLab project (list files and directories)

### File & Content Management
9. `get_file_contents` - Get the contents of a file or directory from a GitLab project
10. `create_or_update_file` - Create or update a single file in a GitLab project
11. `push_files` - Push multiple files to a GitLab project in a single commit
12. `create_branch` - Create a new branch in a GitLab project
13. `upload_markdown` - Upload a file to a GitLab project for use in markdown content
14. `download_attachment` - Download an uploaded file from a GitLab project by secret and filename

### Issues Management
15. `create_issue` - Create a new issue in a GitLab project
16. `list_issues` - List issues (default: created by current user only; use scope='all' for all accessible issues)
17. `my_issues` - List issues assigned to the authenticated user (defaults to open issues)
18. `get_issue` - Get details of a specific issue in a GitLab project
19. `update_issue` - Update an issue in a GitLab project
20. `delete_issue` - Delete an issue from a GitLab project
21. `list_issue_links` - List all issue links for a specific issue
22. `list_issue_discussions` - List discussions for an issue in a GitLab project
23. `get_issue_link` - Get a specific issue link
24. `create_issue_link` - Create an issue link between two issues
25. `delete_issue_link` - Delete an issue link
26. `create_note` - Create a new note (comment) to an issue or merge request
27. `update_issue_note` - Modify an existing issue thread note
28. `create_issue_note` - Add a new note to an existing issue thread

### Merge Requests & Code Review
29. `create_merge_request` - Create a new merge request in a GitLab project
30. `list_merge_requests` - List merge requests in a GitLab project with filtering options
31. `get_merge_request` - Get details of a merge request (Either mergeRequestIid or branchName must be provided)
32. `get_merge_request_diffs` - Get the changes/diffs of a merge request (Either mergeRequestIid or branchName must be provided)
33. `list_merge_request_diffs` - List merge request diffs with pagination support (Either mergeRequestIid or branchName must be provided)
34. `get_branch_diffs` - Get the changes/diffs between two branches or commits in a GitLab project
35. `update_merge_request` - Update a merge request (Either mergeRequestIid or branchName must be provided)
36. `merge_merge_request` - Merge a merge request in a GitLab project
37. `create_merge_request_thread` - Create a new thread on a merge request
38. `mr_discussions` - List discussion items for a merge request
39. `update_merge_request_note` - Modify an existing merge request thread note
40. `create_merge_request_note` - Add a new note to an existing merge request thread

### Draft Notes Management
41. `get_draft_note` - Get a single draft note from a merge request
42. `list_draft_notes` - List draft notes for a merge request
43. `create_draft_note` - Create a draft note for a merge request
44. `update_draft_note` - Update an existing draft note
45. `delete_draft_note` - Delete a draft note
46. `publish_draft_note` - Publish a single draft note
47. `bulk_publish_draft_notes` - Publish all draft notes for a merge request

### Labels Management
48. `list_labels` - List labels for a project
49. `get_label` - Get a single label from a project
50. `create_label` - Create a new label in a project
51. `update_label` - Update an existing label in a project
52. `delete_label` - Delete a label from a project

### Namespaces & Users
53. `list_namespaces` - List all namespaces available to the current user
54. `get_namespace` - Get details of a namespace by ID or path
55. `verify_namespace` - Verify if a namespace path exists
56. `get_users` - Get GitLab user details by usernames

### Commits & Repository History
57. `list_commits` - List repository commits with filtering options
58. `get_commit` - Get details of a specific commit
59. `get_commit_diff` - Get changes/diffs of a specific commit

### Events & Activity
60. `list_events` - List all events for the currently authenticated user
61. `get_project_events` - List all visible events for a specified project

### Wiki Management (when USE_GITLAB_WIKI=true)
62. `list_wiki_pages` - List wiki pages in a GitLab project
63. `get_wiki_page` - Get details of a specific wiki page
64. `create_wiki_page` - Create a new wiki page in a GitLab project
65. `update_wiki_page` - Update an existing wiki page in a GitLab project
66. `delete_wiki_page` - Delete a wiki page from a GitLab project

### Milestones Management (when USE_MILESTONE=true)
67. `list_milestones` - List milestones in a GitLab project with filtering options
68. `get_milestone` - Get details of a specific milestone
69. `create_milestone` - Create a new milestone in a GitLab project
70. `edit_milestone` - Edit an existing milestone in a GitLab project
71. `delete_milestone` - Delete a milestone from a GitLab project
72. `get_milestone_issue` - Get issues associated with a specific milestone
73. `get_milestone_merge_requests` - Get merge requests associated with a specific milestone
74. `promote_milestone` - Promote a milestone to the next stage
75. `get_milestone_burndown_events` - Get burndown events for a specific milestone
76. `list_group_iterations` - List group iterations with filtering options

### Pipeline & CI/CD Management (when USE_PIPELINE=true)
77. `list_pipelines` - List pipelines in a GitLab project with filtering options
78. `get_pipeline` - Get details of a specific pipeline in a GitLab project
79. `list_pipeline_jobs` - List all jobs in a specific pipeline
80. `list_pipeline_trigger_jobs` - List all trigger jobs (bridges) in a specific pipeline that trigger downstream pipelines
81. `get_pipeline_job` - Get details of a GitLab pipeline job number
82. `get_pipeline_job_output` - Get the output/trace of a GitLab pipeline job with optional pagination to limit context window usage
83. `create_pipeline` - Create a new pipeline for a branch or tag
84. `retry_pipeline` - Retry a failed or canceled pipeline
85. `cancel_pipeline` - Cancel a running pipeline
86. `play_pipeline_job` - Run a manual pipeline job
87. `retry_pipeline_job` - Retry a failed or canceled pipeline job
88. `cancel_pipeline_job` - Cancel a running pipeline job

### Work Items Management (when USE_WORKITEMS=true)
89. `get_project_workitem_types` - Get work item types for a project
90. `list_project_workitems` - List work items in a project
91. `create_project_workitem` - Create a new work item in a project
92. `get_project_workitem` - Get details of a work item
93. `update_project_workitem` - Update a work item
94. `delete_project_workitem` - Delete a work item

**Total: 94 Tools Available** (core tools always enabled, additional tools enabled via environment flags)

<!-- TOOLS-END -->

</details>

## Support the Project

If you find this GitLab MCP Server useful, consider supporting its continued development and maintenance.

<div align="center">
  <img src="assets/usdt-qr.svg" alt="USDT TRC-20 Donation QR Code" width="150" height="150">
  <br>
  <small>📱 <strong>USDT (TRC-20)</strong></small><br>
  <code>TFDsezHa1cBkoeZT5q2T49Wp66K8t2DmdA</code>
  <br><br>
  <em>Scan with any TRC-20 compatible wallet (TronLink, Trust Wallet, Exodus, etc.)</em>
</div>

---

**Maintained with ❤️ by [Dmitry Prudnikov](https://github.com/polaz)**
**Original work by [zereight](https://github.com/zereight) - Thank you for the foundation!**
