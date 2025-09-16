# GitLab MCP Server

**Maintained by:** [Dmitry Prudnikov](https://github.com/polaz) | **Original Author:** [zereight](https://github.com/zereight)

## @structured-world/gitlab-mcp

A fork of the original [zereight/mcp-gitlab](https://github.com/zereight/gitlab-mcp)

![npm version](https://img.shields.io/npm/v/@structured-world/gitlab-mcp) ![npm downloads](https://img.shields.io/npm/dm/@structured-world/gitlab-mcp) ![Release](https://github.com/structured-world/gitlab-mcp/workflows/Release/badge.svg) ![Codecov](https://codecov.io/gh/structured-world/gitlab-mcp/branch/main/graph/badge.svg) [![Coverage Report](https://img.shields.io/badge/Coverage-Live%20Report-brightgreen?logo=github)](https://structured-world.github.io/gitlab-mcp/coverage/)

GitLab MCP(Model Context Protocol) Server. **Includes bug fixes and improvements over the original GitLab MCP server.**

This fork is actively maintained and enhanced with strict TypeScript standards, Yarn 4 support, and improved development workflows.

## Requirements

- **Node.js**: >=18.0.0 (required for native fetch API support)
- **GitLab**: Compatible with GitLab.com and self-hosted instances

## Usage

### Using with Claude App, Cline, Roo Code, Cursor, Kilo Code

When using with the Claude App, you need to set up your API key and URLs directly.

#### npx

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "your_gitlab_api_url",
        "GITLAB_PROJECT_ID": "your_project_id", // Optional: default project
        "GITLAB_ALLOWED_PROJECT_IDS": "", // Optional: comma-separated list of allowed project IDs
        "GITLAB_READ_ONLY_MODE": "false",
        "USE_GITLAB_WIKI": "false", // use wiki api?
        "USE_MILESTONE": "false", // use milestone api?
        "USE_PIPELINE": "false", // use pipeline api?
        "USE_VARIABLES": "true", // use variables api?
        "SKIP_TLS_VERIFY": "false" // skip SSL cert verification (dev only)
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
      "args": ["-y", "@structured-world/gitlab-mcp"],
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
        "-e",
        "USE_VARIABLES",
        "ghcr.io/structured-world/gitlab-mcp:latest"
      ],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_token",
        "GITLAB_API_URL": "https://gitlab.com", // Optional, for self-hosted GitLab
        "GITLAB_READ_ONLY_MODE": "false",
        "USE_GITLAB_WIKI": "true",
        "USE_MILESTONE": "true",
        "USE_PIPELINE": "true",
        "USE_VARIABLES": "true"
      }
    }
  }
}
```

- sse

```shell
docker run -i --rm \
  -e GITLAB_TOKEN=your_gitlab_token \
  -e GITLAB_API_URL="https://gitlab.com" \
  -e GITLAB_READ_ONLY_MODE=true \
  -e USE_GITLAB_WIKI=true \
  -e USE_MILESTONE=true \
  -e USE_PIPELINE=true \
  -e SSE=true \
  -p 3333:3002 \
  ghcr.io/structured-world/gitlab-mcp:latest
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
  -e GITLAB_API_URL="https://gitlab.com" \
  -e GITLAB_READ_ONLY_MODE=true \
  -e USE_GITLAB_WIKI=true \
  -e USE_MILESTONE=true \
  -e USE_PIPELINE=true \
  -e STREAMABLE_HTTP=true \
  -p 3333:3002 \
  ghcr.io/structured-world/gitlab-mcp:latest
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
- `GITLAB_API_URL`: Your GitLab API URL. (Default: `https://gitlab.com`)
- `GITLAB_PROJECT_ID`: Default project ID. If set, Overwrite this value when making an API request.
- `GITLAB_ALLOWED_PROJECT_IDS`: Optional comma-separated list of allowed project IDs. When set with a single value, acts as a default project (like the old "lock" mode). When set with multiple values, restricts access to only those projects. Examples:
  - Single value `123`: MCP server can only access project 123 and uses it as default
  - Multiple values `123,456,789`: MCP server can access projects 123, 456, and 789 but requires explicit project ID in requests
- `GITLAB_READ_ONLY_MODE`: When set to 'true', restricts the server to only expose read-only operations. Useful for enhanced security or when write access is not needed. Also useful for using with Cursor and it's 40 tool limit.
- `GITLAB_DENIED_TOOLS_REGEX`: When set as a regular expression, it excludes the matching tools.
- `USE_GITLAB_WIKI`: When set to 'true', enables the wiki-related tools (list_wiki_pages, get_wiki_page, create_wiki_page, update_wiki_page, delete_wiki_page). Supports both project-level and group-level wikis. By default, wiki features are disabled.
- `USE_MILESTONE`: When set to 'true', enables the milestone-related tools (list_milestones, get_milestone, create_milestone, edit_milestone, delete_milestone, get_milestone_issue, get_milestone_merge_requests, promote_milestone, get_milestone_burndown_events). By default, milestone features are disabled.
- `USE_PIPELINE`: When set to 'true', enables the pipeline-related tools (list_pipelines, get_pipeline, list_pipeline_jobs, list_pipeline_trigger_jobs, get_pipeline_job, get_pipeline_job_output, create_pipeline, retry_pipeline, cancel_pipeline, play_pipeline_job, retry_pipeline_job, cancel_pipeline_job). By default, pipeline features are disabled.
- `USE_LABELS`: When set to 'true', enables the label-related tools (list_labels, get_label, create_label, update_label, delete_label). By default, label features are enabled.
- `USE_MRS`: When set to 'true', enables the merge request-related tools (list_merge_requests, get_merge_request, create_merge_request, update_merge_request, merge_merge_request, get_merge_request_diffs, list_merge_request_diffs, mr_discussions, create_merge_request_thread, create_merge_request_note, update_merge_request_note, create_draft_note, update_draft_note, delete_draft_note, publish_draft_note, bulk_publish_draft_notes, get_draft_note, list_draft_notes). By default, merge request features are enabled.
- `USE_FILES`: When set to 'true', enables the file-related tools (get_file_contents, get_repository_tree, create_or_update_file, push_files, upload_markdown). By default, file operation features are enabled.
- `USE_VARIABLES`: When set to 'true', enables the CI/CD variables-related tools (list_variables, get_variable, create_variable, update_variable, delete_variable). Supports both project-level and group-level variables. By default, variables features are enabled.
- `GITLAB_AUTH_COOKIE_PATH`: Path to an authentication cookie file for GitLab instances that require cookie-based authentication. When provided, the cookie will be included in all GitLab API requests.
- `SKIP_TLS_VERIFY`: When set to 'true', skips TLS certificate verification for all GitLab API requests (both REST and GraphQL). **WARNING**: This bypasses SSL certificate validation and should only be used for testing with self-signed certificates or trusted internal GitLab instances. Never use this in production environments.
- `SSE`: When set to 'true', enables the Server-Sent Events transport.
- `STREAMABLE_HTTP`: When set to 'true', enables the Streamable HTTP transport. If both **SSE** and **STREAMABLE_HTTP** are set to 'true', the server will prioritize Streamable HTTP over SSE transport.

### Dynamic Tool Description Customization

You can customize tool descriptions at runtime using environment variables following the pattern `GITLAB_TOOL_{TOOL_NAME}`. This is useful for:

- Providing context-specific descriptions for your team
- Translating tool descriptions to different languages
- Adding organization-specific documentation or warnings
- Simplifying descriptions for non-technical users

#### Format
```bash
GITLAB_TOOL_{TOOL_NAME}="Your custom description"
```

Where `{TOOL_NAME}` is the uppercase version of the tool name with underscores preserved.

#### Examples
```bash
# Customize the list_projects tool description
export GITLAB_TOOL_LIST_PROJECTS="Show all available GitLab projects in our organization"

# Customize the create_merge_request tool description
export GITLAB_TOOL_CREATE_MERGE_REQUEST="Create a new MR following our team's review process"

# Customize the get_file_contents tool description
export GITLAB_TOOL_GET_FILE_CONTENTS="Read source code files from the repository"

# Multiple customizations
export GITLAB_TOOL_LIST_PROJECTS="List user projects"
export GITLAB_TOOL_GET_PROJECT="Get project details including settings"
export GITLAB_TOOL_CREATE_WORK_ITEM="Create tickets for our sprint planning"
```

#### Usage in Configuration Files
```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@structured-world/gitlab-mcp"],
      "env": {
        "GITLAB_TOKEN": "your_token",
        "GITLAB_API_URL": "https://gitlab.com",

        "GITLAB_TOOL_LIST_PROJECTS": "Show our team's GitLab projects",
        "GITLAB_TOOL_CREATE_MERGE_REQUEST": "Create MR with our review standards",
        "GITLAB_TOOL_GET_FILE_CONTENTS": "Read code from repo"
      }
    }
  }
}
```

#### Important Notes

- **Description Override Only**: Only the tool description is overridden - the tool name and functionality remain unchanged
- **Schema Preservation**: Schema field descriptions are NOT affected - they remain hardcoded for consistency
- **Case Sensitivity**: Tool names in environment variables must be UPPERCASE (e.g., `LIST_PROJECTS` not `list_projects`)
- **Invalid Names**: Invalid tool names in environment variables are ignored with a warning in debug logs
- **Content Guidelines**: Descriptions can be any valid string but should be kept concise for better UX
- **Scope**: Works with all 86 available tools across all entities (Core, Work Items, Merge Requests, Files, etc.)

## Tools 🛠️

**86 Tools Available** - Organized by entity and functionality below.

### Key Features:
- **Modular Entity Architecture** - Separate entities for Labels, Merge Requests, Files, Pipelines, etc.
- **Environment-Gated Features** - Enable/disable tool groups with USE_* environment variables
- **Work Items Management** - Modern GraphQL API for Issues, Epics, Tasks, and more
- **Complete GitLab API Coverage** - Repository, Merge Requests, Pipelines, Wiki, and more
- **Tier-based Feature Detection** - Automatically enables features based on your GitLab tier
- **Read-only Mode Support** - Safe operation mode for production environments

### Migration from v2.0:
All issue management has been migrated to the Work Items GraphQL API. The legacy REST API issue tools (`create_issue`, `update_issue`, etc.) have been removed. Use the Work Items tools (`create_work_item`, `update_work_item`, etc.) instead for better performance and more features.

<details>
<summary>Removed/Migrated Tools from v2.0</summary>

The following issue-related tools have been removed and replaced by Work Items GraphQL API:

- `create_issue` → Use `create_work_item` instead
- `update_issue` → Use `update_work_item` instead
- `delete_issue` → Use `delete_work_item` instead
- `list_issues` → Use `list_work_items` instead
- `my_issues` → Use `list_work_items` with assignee filter
- `get_issue` → Use `get_work_item` instead
- `create_issue_link` → Use `update_work_item` with LINKED_ITEMS widget
- `delete_issue_link` → Use `update_work_item` with LINKED_ITEMS widget
- `update_issue_note` → Use `update_work_item` with NOTES widget
- `create_issue_note` → Use `update_work_item` with NOTES widget
- `list_issue_links` → Use Work Items GraphQL API
- `list_issue_discussions` → Use Work Items GraphQL API
- `get_issue_link` → Use Work Items GraphQL API

</details>

## Complete Tool Reference

### Legend
- 📖 = Read-only tool (available in GITLAB_READ_ONLY_MODE)
- ✏️ = Read/Write tool (disabled in GITLAB_READ_ONLY_MODE)

### Core Tools (22 tools)
Core GitLab functionality always available.

#### Repository & Project Management
- ✏️ **`create_repository`**: Create a new GitLab project
- 📖 **`get_project`**: Get details of a specific project
- 📖 **`list_projects`**: List projects accessible by the current user
- 📖 **`search_repositories`**: Search for GitLab projects
- 📖 **`list_group_projects`**: List projects in a GitLab group with filtering options
- 📖 **`list_project_members`**: List members of a GitLab project

#### Branch Management
- ✏️ **`create_branch`**: Create a new branch in a GitLab project
- 📖 **`get_branch_diffs`**: Get the changes/diffs between two branches or commits in a GitLab project
- ✏️ **`fork_repository`**: Fork a GitLab project to your account or specified namespace

#### Comments & General Notes
- ✏️ **`create_note`**: Create a new note (comment) to an issue or merge request
- 📖 **`download_attachment`**: Download an uploaded file from a GitLab project by secret and filename

#### Commits & History
- 📖 **`get_commit`**: Get details of a specific commit
- 📖 **`get_commit_diff`**: Get changes/diffs of a specific commit
- 📖 **`list_commits`**: List repository commits with filtering options

#### Namespaces & Users
- 📖 **`get_namespace`**: Get details of a namespace by ID or path
- 📖 **`list_namespaces`**: List all namespaces available to the current user
- 📖 **`verify_namespace`**: Verify if a namespace path exists
- 📖 **`get_users`**: Get GitLab user details by usernames

#### Events & Activity
- 📖 **`get_project_events`**: List all visible events for a specified project. Note: before/after parameters accept date format YYYY-MM-DD only
- 📖 **`list_events`**: List all events for the currently authenticated user. Note: before/after parameters accept date format YYYY-MM-DD only
- 📖 **`list_group_iterations`**: List group iterations with filtering options

### Labels Management (5 tools)
Requires USE_LABELS=true environment variable (enabled by default). Supports both project and group labels.

- ✏️ **`create_label`**: Create a new label in a project or group
- ✏️ **`update_label`**: Update an existing label in a project or group
- ✏️ **`delete_label`**: Delete a label from a project or group
- 📖 **`get_label`**: Get a single label from a project or group
- 📖 **`list_labels`**: List labels for a project or group

### Merge Requests Management (17 tools)
Requires USE_MRS=true environment variable (enabled by default).

#### Merge Request Operations
- ✏️ **`create_merge_request`**: Create a new merge request in a GitLab project
- ✏️ **`update_merge_request`**: Update a merge request (Either mergeRequestIid or branchName must be provided)
- ✏️ **`merge_merge_request`**: Merge a merge request in a GitLab project
- 📖 **`get_merge_request`**: Get details of a merge request (Either mergeRequestIid or branchName must be provided)
- 📖 **`get_merge_request_diffs`**: Get the changes/diffs of a merge request (Either mergeRequestIid or branchName must be provided)
- 📖 **`list_merge_request_diffs`**: List merge request diffs with pagination support (Either mergeRequestIid or branchName must be provided)
- 📖 **`list_merge_requests`**: List merge requests in a GitLab project with filtering options
- 📖 **`mr_discussions`**: List discussion items for a merge request

#### MR Comments & Discussions
- ✏️ **`create_merge_request_thread`**: Create a new thread on a merge request
- ✏️ **`create_merge_request_note`**: Add a new note to an existing merge request thread
- ✏️ **`update_merge_request_note`**: Modify an existing merge request thread note

#### MR Draft Notes
- ✏️ **`create_draft_note`**: Create a draft note for a merge request
- ✏️ **`update_draft_note`**: Update an existing draft note
- ✏️ **`delete_draft_note`**: Delete a draft note
- ✏️ **`publish_draft_note`**: Publish a single draft note
- ✏️ **`bulk_publish_draft_notes`**: Publish all draft notes for a merge request
- 📖 **`get_draft_note`**: Get a single draft note from a merge request
- 📖 **`list_draft_notes`**: List draft notes for a merge request

### File Operations (5 tools)
Requires USE_FILES=true environment variable (enabled by default).

- ✏️ **`create_or_update_file`**: Create or update a single file in a GitLab project
- ✏️ **`push_files`**: Push multiple files to a GitLab project in a single commit
- 📖 **`get_file_contents`**: Get the contents of a file or directory from a GitLab project
- 📖 **`get_repository_tree`**: Get the repository tree for a GitLab project (list files and directories)
- ✏️ **`upload_markdown`**: Upload a file to a GitLab project for use in markdown content

### CI/CD Variables (5 tools)
Requires USE_VARIABLES=true environment variable (enabled by default). Supports both project-level and group-level variables.

- 📖 **`list_variables`**: List all CI/CD variables for a project or group with their configuration and security settings
- 📖 **`get_variable`**: Get a specific CI/CD variable by key from a project or group, optionally filtered by environment scope
- ✏️ **`create_variable`**: Create a new CI/CD variable for automated deployments and pipeline configuration in a project or group
- ✏️ **`update_variable`**: Update an existing CI/CD variable's value, security settings, or configuration in a project or group
- ✏️ **`delete_variable`**: Remove a CI/CD variable from a project or group

### Work Items (6 tools)
Modern GraphQL API for issues, epics, tasks, and more. Requires USE_WORKITEMS=true (enabled by default).

- ✏️ **`create_work_item`**: Create a new work item (epic, issue, task, etc.) in a GitLab group
- ✏️ **`update_work_item`**: Update an existing work item
- ✏️ **`delete_work_item`**: Delete a work item
- 📖 **`get_work_item`**: Get details of a specific work item by ID
- 📖 **`get_work_item_types`**: Get available work item types for a group
- 📖 **`list_work_items`**: List work items from a GitLab group with optional filtering by type

### Wiki Management (5 tools)
Requires USE_GITLAB_WIKI=true environment variable. Supports both project-level and group-level wikis.

- ✏️ **`create_wiki_page`**: Create a new wiki page in a GitLab project or group
- ✏️ **`update_wiki_page`**: Update an existing wiki page in a GitLab project or group
- ✏️ **`delete_wiki_page`**: Delete a wiki page from a GitLab project or group
- 📖 **`get_wiki_page`**: Get details of a specific wiki page from a project or group
- 📖 **`list_wiki_pages`**: List wiki pages in a GitLab project or group

### Milestones (9 tools)
Requires USE_MILESTONE=true environment variable. Supports both project and group milestones.

- ✏️ **`create_milestone`**: Create a new milestone in a GitLab project or group
- ✏️ **`edit_milestone`**: Edit an existing milestone in a GitLab project or group
- ✏️ **`delete_milestone`**: Delete a milestone from a GitLab project or group
- ✏️ **`promote_milestone`**: Promote a project milestone to a group milestone
- 📖 **`get_milestone`**: Get details of a specific project or group milestone
- 📖 **`get_milestone_issue`**: Get issues associated with a specific project or group milestone
- 📖 **`get_milestone_merge_requests`**: Get merge requests associated with a specific project or group milestone
- 📖 **`get_milestone_burndown_events`**: Get burndown events for a specific project or group milestone
- 📖 **`list_milestones`**: List milestones in a GitLab project or group with filtering options

### Pipelines & CI/CD (12 tools)
Requires USE_PIPELINE=true environment variable.

- ✏️ **`create_pipeline`**: Create a new pipeline for a branch or tag
- ✏️ **`retry_pipeline`**: Retry a failed or canceled pipeline
- ✏️ **`cancel_pipeline`**: Cancel a running pipeline
- ✏️ **`play_pipeline_job`**: Run a manual pipeline job
- ✏️ **`retry_pipeline_job`**: Retry a failed or canceled pipeline job
- ✏️ **`cancel_pipeline_job`**: Cancel a running pipeline job
- 📖 **`get_pipeline`**: Get details of a specific pipeline in a GitLab project
- 📖 **`get_pipeline_job`**: Get details of a GitLab pipeline job number
- 📖 **`get_pipeline_job_output`**: Get the output/trace of a GitLab pipeline job with optional pagination to limit context window usage
- 📖 **`list_pipelines`**: List pipelines in a GitLab project with filtering options
- 📖 **`list_pipeline_jobs`**: List all jobs in a specific pipeline
- 📖 **`list_pipeline_trigger_jobs`**: List all trigger jobs (bridges) in a specific pipeline that trigger downstream pipelines

## Testing

This project includes comprehensive integration tests that verify functionality against a real GitLab instance.

### Running Tests

```bash
# Run all tests (requires .env.test configuration)
yarn test

# Run with verbose output
yarn test --verbose

# Run specific test suites
yarn test tests/integration/data-lifecycle.test.ts
yarn test tests/integration/schemas/workitems.test.ts
```

### Test Architecture

- **200+ integration tests** running against real GitLab 18.3 Ultimate instance
- **Data lifecycle pattern** - Creates test infrastructure once, shared across dependent tests
- **Work Items CRUD testing** - Complete Create/Read/Update/Delete for both Issues and Epics
- **Schema validation** - All 50+ schemas validated against real API responses
- **Dependency chain** - Tests run in proper order using `--runInBand` for reliable results

For detailed testing documentation, see [TESTING.md](TESTING.md).

## 💖 Support the Project

This GitLab MCP Server is developed and maintained with care for the community. If it saves you time or helps your workflow, consider supporting its continued development!

<div align="center">

![USDT TRC-20 Donation QR Code](assets/usdt-qr.svg)

☕ **Buy me a coffee with USDT (TRC-20)**
`TFDsezHa1cBkoeZT5q2T49Wp66K8t2DmdA`

📱 *Scan QR code with your wallet (TronLink, Trust Wallet, Exodus, etc.)*

**Every contribution helps keep this project alive and growing! 🚀**

</div>

---

**Maintained with ❤️ by [Dmitry Prudnikov](https://github.com/polaz)**
**Original work by [zereight](https://github.com/zereight) - Thank you for the foundation!**
