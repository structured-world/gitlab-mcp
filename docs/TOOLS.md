# GitLab MCP Tools Reference

> Auto-generated from source code. Do not edit manually.
> Generated: 2026-01-24 | Tools: 44 | Version: 6.40.0

## Table of Contents

- [Projects & Repository (12)](#projects-&-repository)
- [Collaboration (10)](#collaboration)
- [Planning (7)](#planning)
- [CI/CD (5)](#ci/cd)
- [Integrations & Content (8)](#integrations-&-content)
- [Discovery (1)](#discovery)
- [Session (1)](#session)

---

## Projects & Repository

### browse_projects [tier: Free]

Find, list, or inspect GitLab projects. Actions: search (find by name/topic across GitLab), list (browse accessible projects or group projects), get (retrieve full project details). Related: manage_project to create/update/delete projects.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `search` | Free | Find projects by criteria using global search API |
| `list` | Free | Browse accessible projects with optional group scope |
| `get` | Free | Retrieve specific project details |

#### Parameters

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project identifier. Numeric ID or URL-encoded path (e.g., "42" or "gitlab-org%2Fgitlab"). |
| `license` | boolean | No | Include license information. |
| `statistics` | boolean | No | Include repository statistics. |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `simple` | boolean | Yes | Return minimal fields for faster response. Default: true. |
| `archived` | boolean | No | Filter by archive status. true=archived only, false=active only. |
| `group_id` | string | No | Group ID to list projects within. If omitted, lists YOUR accessible projects. |
| `include_subgroups` | boolean | No | Include projects from subgroups (requires group_id). |
| `membership` | boolean | No | Show only projects where you have membership. |
| `order_by` | string | No | Sort field for results. |
| `owned` | boolean | No | Show only projects you own (not just member of). |
| `page` | integer | No | Page number |
| `search` | string | No | Text filter for list action (filters results by name/description). |
| `sort` | string | No | Sort direction: asc or desc. |
| `starred` | boolean | No | Show only starred/favorited projects. |
| `visibility` | string | No | Filter by visibility: public, internal, or private. |
| `with_programming_language` | string | No | Filter by programming language (e.g., "javascript", "python"). |
| `with_shared` | boolean | No | Include shared projects (requires group_id). |

**Action `search`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `archived` | boolean | No | Filter by archive status. true=archived only, false=active only. |
| `order_by` | string | No | Sort field for results. |
| `page` | integer | No | Page number |
| `q` | string | No | Global search query. Searches project names, paths, descriptions. |
| `sort` | string | No | Sort direction: asc or desc. |
| `visibility` | string | No | Filter by visibility: public, internal, or private. |
| `with_programming_language` | string | No | Filter by programming language (e.g., "javascript", "python"). |

#### Example

```json
{
  "action": "search",
  "per_page": 10
}
```

---

### browse_namespaces [tier: Free]

Explore GitLab groups and user namespaces. Actions: list (discover available namespaces), get (retrieve details with storage stats), verify (check if path exists). Related: manage_namespace to create/update/delete groups.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | Browse namespaces with optional filtering |
| `get` | Free | Retrieve namespace details |
| `verify` | Free | Check if namespace exists |

#### Parameters

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace_id` | string | Yes | Namespace ID or path. |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `min_access_level` | number | No | Minimum access level: 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner. |
| `owned_only` | boolean | No | Show only namespaces you own. |
| `page` | integer | No | Page number |
| `search` | string | No | Search namespaces by name/path. |
| `top_level_only` | boolean | No | Show only root-level namespaces. |
| `with_statistics` | boolean | No | Include storage/count statistics. |

**Action `verify`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace_id` | string | Yes | Namespace ID or path. |

#### Example

```json
{
  "action": "list",
  "per_page": 10
}
```

---

### browse_commits [tier: Free]

Explore repository commit history and diffs. Actions: list (browse commits with filters), get (retrieve commit metadata and stats), diff (view code changes). Related: browse_refs for branch/tag info.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | Browse commit history |
| `get` | Free | Retrieve commit details |
| `diff` | Free | Get code changes in a commit |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path. |

**Action `diff`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `sha` | string | Yes | Commit SHA. Can be full SHA, short hash, or ref name. |
| `page` | integer | No | Page number |
| `unidiff` | boolean | No | Return unified diff format. |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sha` | string | Yes | Commit SHA. Can be full SHA, short hash, or ref name. |
| `stats` | boolean | No | Include file change statistics. |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `all` | boolean | No | Include commits from all branches. |
| `author` | string | No | Filter by author name or email. |
| `first_parent` | boolean | No | Follow only first parent (linear history). |
| `order` | string | No | Commit ordering: default or topo. |
| `page` | integer | No | Page number |
| `path` | string | No | Filter commits affecting this file/directory path. |
| `ref_name` | string | No | Branch/tag name. Defaults to default branch. |
| `since` | string | No | Start date filter (ISO 8601 format). |
| `trailers` | boolean | No | Include Git trailers (Signed-off-by, etc.). |
| `until` | string | No | End date filter (ISO 8601 format). |
| `with_stats` | boolean | No | Include stats for each commit. |

#### Example

```json
{
  "action": "list",
  "project_id": "my-group/my-project",
  "per_page": 10
}
```

---

### browse_events [tier: Free]

Track GitLab activity and events. Actions: user (your activity across all projects), project (specific project activity feed). Filter by date range, action type, or target type.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `user` | Free | Show your activity across all projects |
| `project` | Free | Show specific project activity |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `after` | string | No | Show events after this date (YYYY-MM-DD). |
| `before` | string | No | Show events before this date (YYYY-MM-DD). |
| `event_action` | string | No | Filter by event action. |
| `page` | integer | No | Page number |
| `sort` | string | No | Sort order: asc=oldest first, desc=newest first. |
| `target_type` | string | No | Filter by target type. |

**Action `project`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID. |

#### Example

```json
{
  "action": "user",
  "per_page": 10
}
```

---

### manage_project [tier: Free]

Create, update, or manage GitLab projects. Actions: create (new project with settings), fork (copy existing project), update (modify settings), delete (remove permanently), archive/unarchive (toggle read-only), transfer (move to different namespace). Related: browse_projects for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new project |
| `fork` | Free | Fork an existing project |
| `update` | Free | Update project settings |
| `delete` | Free | Delete a project permanently |
| `archive` | Free | Archive a project (read-only mode) |
| `unarchive` | Free | Unarchive a project (restore from archive) |
| `transfer` | Free | Transfer project to a different namespace |

#### Parameters

**Action `archive`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path. |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Project name. |
| `description` | string | No | Project description. |
| `initialize_with_readme` | boolean | No | Create initial README.md file. |
| `issues_enabled` | boolean | No | Enable issue tracking. |
| `jobs_enabled` | boolean | No | Enable CI/CD jobs. |
| `lfs_enabled` | boolean | No | Enable Git LFS. |
| `merge_requests_enabled` | boolean | No | Enable merge requests. |
| `namespace` | string | No | Target namespace path. Omit for current user namespace. |
| `only_allow_merge_if_all_discussions_are_resolved` | boolean | No | Require resolved discussions for merge. |
| `only_allow_merge_if_pipeline_succeeds` | boolean | No | Require passing pipelines for merge. |
| `request_access_enabled` | boolean | No | Allow access requests. |
| `snippets_enabled` | boolean | No | Enable code snippets. |
| `visibility` | string | No | Project visibility level. |
| `wiki_enabled` | boolean | No | Enable project wiki. |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path. |

**Action `fork`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Source project to fork. Numeric ID or URL-encoded path. |
| `fork_name` | string | No | New name for forked project (maps to API 'name' parameter). |
| `fork_path` | string | No | New path for forked project (maps to API 'path' parameter). |
| `issues_enabled` | boolean | No | Enable issue tracking. |
| `jobs_enabled` | boolean | No | Enable CI/CD jobs. |
| `lfs_enabled` | boolean | No | Enable Git LFS. |
| `merge_requests_enabled` | boolean | No | Enable merge requests. |
| `namespace` | string | No | Target namespace path. Omit for current user namespace. |
| `namespace_path` | string | No | Target namespace path for fork. |
| `only_allow_merge_if_all_discussions_are_resolved` | boolean | No | Require resolved discussions for merge. |
| `only_allow_merge_if_pipeline_succeeds` | boolean | No | Require passing pipelines for merge. |
| `request_access_enabled` | boolean | No | Allow access requests. |
| `snippets_enabled` | boolean | No | Enable code snippets. |
| `wiki_enabled` | boolean | No | Enable project wiki. |

**Action `transfer`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | Target namespace ID or path to transfer to. |
| `project_id` | string | Yes | Project ID or URL-encoded path. |

**Action `unarchive`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path. |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path. |
| `default_branch` | string | No | Set default branch name. |
| `description` | string | No | New project description. |
| `issues_enabled` | boolean | No | Enable issue tracking. |
| `jobs_enabled` | boolean | No | Enable CI/CD jobs. |
| `lfs_enabled` | boolean | No | Enable Git LFS. |
| `merge_requests_enabled` | boolean | No | Enable merge requests. |
| `name` | string | No | New project name. |
| `only_allow_merge_if_all_discussions_are_resolved` | boolean | No | Require resolved discussions for merge. |
| `only_allow_merge_if_pipeline_succeeds` | boolean | No | Require passing pipelines for merge. |
| `request_access_enabled` | boolean | No | Allow access requests. |
| `snippets_enabled` | boolean | No | Enable code snippets. |
| `visibility` | string | No | New visibility level. |
| `wiki_enabled` | boolean | No | Enable project wiki. |

#### Example

```json
{
  "action": "create",
  "name": "example_name"
}
```

---

### manage_namespace [tier: Free]

Create, update, or delete GitLab groups/namespaces. Actions: create (new group with visibility/settings), update (modify group settings), delete (remove permanently). Related: browse_namespaces for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new group/namespace |
| `update` | Free | Update group settings |
| `delete` | Free | Delete a group permanently |

#### Parameters

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Group display name. |
| `path` | string | Yes | Group path for URLs (URL-safe). |
| `visibility` | string | Yes | Group visibility level. |
| `avatar` | string | No | Group avatar URL. |
| `default_branch_protection` | number | No | Branch protection level: 0=none, 1=partial, 2=full. |
| `description` | string | No | Group description. |
| `lfs_enabled` | boolean | No | Enable Git LFS. |
| `parent_id` | number | No | Parent group ID for subgroup. |
| `request_access_enabled` | boolean | No | Allow access requests. |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `group_id` | string | Yes | Group ID or URL-encoded path. |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `group_id` | string | Yes | Group ID or URL-encoded path. |
| `default_branch_protection` | number | No | Branch protection level: 0=none, 1=partial, 2=full. |
| `description` | string | No | New group description. |
| `lfs_enabled` | boolean | No | Enable Git LFS. |
| `name` | string | No | New group name. |
| `path` | string | No | New group path (URL-safe). |
| `request_access_enabled` | boolean | No | Allow access requests. |
| `visibility` | string | No | New visibility level. |

#### Example

```json
{
  "action": "create",
  "name": "example_name",
  "path": "path/to/file.txt",
  "visibility": "private"
}
```

---

### browse_files [tier: Free]

Explore project file structure and read source code. Actions: tree (list directory contents with recursive depth control), content (read file at specific ref/branch), download_attachment (get uploaded file by secret+filename). Related: manage_files to create/update files.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `tree` | Free | List files and folders in a directory |
| `content` | Free | Read file contents |
| `download_attachment` | Free | Download a file attachment from issues/MRs |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `content`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | Yes | Path to the file to read |
| `ref` | string | No | Branch, tag, or commit SHA |

**Action `download_attachment`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filename` | string | Yes | Original filename of the attachment. |
| `secret` | string | Yes | Security token from the attachment URL. |

**Action `tree`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |
| `path` | string | No | Directory path to list |
| `recursive` | boolean | No | Include nested directories |
| `ref` | string | No | Branch, tag, or commit SHA |

#### Example

```json
{
  "action": "tree",
  "project_id": "my-group/my-project",
  "per_page": 10
}
```

---

### manage_files [tier: Free]

Create, update, or upload repository files. Actions: single (create/update one file with commit message), batch (atomic multi-file commit), upload (add attachment returning markdown link). Related: browse_files to read existing files.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `single` | Free | Create or update a single file |
| `batch` | Free | Commit multiple files atomically |
| `upload` | Free | Upload a file as markdown attachment |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `batch`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `branch` | string | Yes | Target branch name |
| `commit_message` | string | Yes | Commit message |
| `files` | object[] | Yes | Files to commit (at least one required) |
| `author_email` | string | No | Commit author email |
| `author_name` | string | No | Commit author name |
| `start_branch` | string | No | Base branch to start from |

**Action `single`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `branch` | string | Yes | Target branch name |
| `commit_message` | string | Yes | Commit message |
| `content` | string | Yes | File content (text or base64 encoded) |
| `file_path` | string | Yes | Path to the file |
| `author_email` | string | No | Commit author email |
| `author_name` | string | No | Commit author name |
| `encoding` | string | No | Content encoding (default: text) |
| `execute_filemode` | boolean | No | Set executable permission |
| `last_commit_id` | string | No | Last known commit ID for conflict detection |
| `start_branch` | string | No | Base branch to start from |

**Action `upload`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Base64 encoded file content |
| `filename` | string | Yes | Name of the file |

#### Example

```json
{
  "action": "single",
  "project_id": "my-group/my-project",
  "file_path": "path/to/file.txt",
  "content": "File content here",
  "commit_message": "example_commit_message",
  "branch": "main"
}
```

---

### browse_releases [tier: Free]

View project releases and asset download links. Actions: list (releases sorted by date), get (release details by tag name), assets (download link list for release). Related: manage_release to create/publish.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List all releases for a project, sorted by release date |
| `get` | Free | Get a specific release by its tag name |
| `assets` | Free | List all asset links for a specific release |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path (e.g., 'my-group/my-project') |

**Action `assets`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag_name` | string | Yes | The Git tag associated with the release (e.g., 'v1.0.0') |
| `page` | integer | No | Page number |
| `per_page` | integer | No | Number of items per page (max 100) |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag_name` | string | Yes | The Git tag associated with the release (e.g., 'v1.0.0') |
| `include_html_description` | boolean | No | Include HTML-rendered description in response |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `include_html_description` | boolean | No | Include HTML-rendered description in response |
| `order_by` | string | No | Sort releases by field (default: released_at) |
| `page` | integer | No | Page number |
| `per_page` | integer | No | Number of items per page (max 100) |
| `sort` | string | No | Sort direction (default: desc) |

#### Example

```json
{
  "action": "list",
  "project_id": "my-group/my-project"
}
```

---

### manage_release [tier: Free]

Create, update, or delete project releases with asset management. Actions: create (release from tag with notes/assets), update (modify metadata), delete (remove release, tag preserved), create_link (add asset URL), delete_link (remove asset). Related: browse_releases for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new release for an existing or new tag |
| `update` | Free | Update an existing release |
| `delete` | Free | Delete a release (preserves the Git tag) |
| `create_link` | Free | Add an asset link to an existing release |
| `delete_link` | Free | Remove an asset link from a release |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path (e.g., 'my-group/my-project') |
| `tag_name` | string | Yes | The Git tag associated with the release (e.g., 'v1.0.0') |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assets` | object | No | Release assets configuration |
| `description` | string | No | Release description (supports Markdown) |
| `milestones` | string[] | No | Array of milestone titles to associate with the release |
| `name` | string | No | The release title/name |
| `ref` | string | No | Branch/commit SHA to create tag from (if tag does not exist) |
| `released_at` | string | No | Release date/time in ISO 8601 format (e.g., '2024-01-15T12:00:00Z') |
| `tag_message` | string | No | Annotation message for the tag (creates annotated tag) |

**Action `create_link`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Display name for the asset link (must be unique per release) |
| `url` | string | Yes | URL of the asset (must be unique per release) |
| `direct_asset_path` | string | No | Path for direct asset download (e.g., '/binaries/linux-amd64') |
| `link_type` | string | No | Type of asset link (default: other) |

**Action `delete_link`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `link_id` | string | Yes | The ID of the asset link to delete |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | No | Release description (supports Markdown) |
| `milestones` | string[] | No | Array of milestone titles to associate with the release |
| `name` | string | No | The release title/name |
| `released_at` | string | No | Release date/time in ISO 8601 format (e.g., '2024-01-15T12:00:00Z') |

#### Example

```json
{
  "action": "create",
  "project_id": "my-group/my-project",
  "tag_name": "example_tag_name"
}
```

---

### browse_refs [tier: Premium*]

Inspect branches, tags, and their protection rules. Actions: list_branches, get_branch, list_tags, get_tag, list_protected_branches, get_protected_branch, list_protected_tags (protection details and access levels). Related: manage_ref to create/delete/protect, browse_commits for commit history.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list_branches` | Free | List all repository branches with optional search |
| `get_branch` | Free | Get details of a specific branch |
| `list_tags` | Free | List all repository tags |
| `get_tag` | Free | Get details of a specific tag |
| `list_protected_branches` | Free | List all protected branches with their protection rules |
| `get_protected_branch` | Free | Get protection rules for a specific branch |
| `list_protected_tags` | Premium | List all protected tags with their protection rules |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path (e.g., 'my-group/my-project') |

**Action `get_branch`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `branch` | string | Yes | Branch name (URL-encoded if contains slashes) |

**Action `get_protected_branch`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Branch name or wildcard pattern (e.g., 'main', 'release-*') |

**Action `get_tag`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag_name` | string | Yes | Tag name (URL-encoded if contains special characters) |

**Action `list_branches`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | integer | No | Page number |
| `per_page` | integer | No | Number of items per page (max 100) |
| `regex` | string | No | Filter branches by regex pattern |
| `search` | string | No | Filter branches by name (supports wildcards) |

**Action `list_protected_branches`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | integer | No | Page number |
| `per_page` | integer | No | Number of items per page (max 100) |
| `search` | string | No | Filter protected branches by name |

**Action `list_protected_tags`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | integer | No | Page number |
| `per_page` | integer | No | Number of items per page (max 100) |

**Action `list_tags`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `order_by` | string | No | Sort by field (default: updated) |
| `page` | integer | No | Page number |
| `per_page` | integer | No | Number of items per page (max 100) |
| `search` | string | No | Filter tags by name (supports wildcards) |
| `sort` | string | No | Sort direction (default: desc) |

#### Example

```json
{
  "action": "list_branches",
  "project_id": "my-group/my-project"
}
```

---

### manage_ref [tier: Premium*]

Create, delete, and protect branches and tags. Actions: create_branch (from ref), delete_branch, protect_branch (set allowed roles), unprotect_branch, update_branch_protection, create_tag (annotated or lightweight), delete_tag, protect_tag, unprotect_tag. Related: browse_refs for inspection.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create_branch` | Free | Create a new branch from an existing ref |
| `delete_branch` | Free | Delete a branch from the repository |
| `protect_branch` | Free | Add protection rules to a branch or pattern |
| `unprotect_branch` | Free | Remove protection from a branch |
| `update_branch_protection` | Free | Update protection rules for a branch |
| `create_tag` | Free | Create a new tag in the repository |
| `delete_tag` | Free | Delete a tag from the repository |
| `protect_tag` | Premium | Add protection rules to a tag pattern (Premium) |
| `unprotect_tag` | Premium | Remove protection from a tag pattern (Premium) |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path (e.g., 'my-group/my-project') |

**Action `create_branch`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `branch` | string | Yes | Name for the new branch |
| `ref` | string | Yes | Source branch name, tag, or commit SHA to create from |

**Action `create_tag`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ref` | string | Yes | Source branch name or commit SHA to create tag from |
| `tag_name` | string | Yes | Name for the new tag (e.g., 'v1.0.0') |
| `message` | string | No | Annotation message (creates annotated tag if provided) |

**Action `delete_branch`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `branch` | string | Yes | Branch name to delete |

**Action `delete_tag`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag_name` | string | Yes | Tag name to delete |

**Action `protect_branch`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Branch name or wildcard pattern (e.g., 'main', 'release-*') |
| `allow_force_push` | boolean | No | Allow force push to protected branch (default: false) |
| `allowed_to_merge` | object[] | No | Granular merge access (Premium feature) |
| `allowed_to_push` | object[] | No | Granular push access (Premium feature) |
| `allowed_to_unprotect` | object[] | No | Granular unprotect access (Premium feature) |
| `code_owner_approval_required` | boolean | No | Require code owner approval (Premium feature) |
| `merge_access_level` | integer | No | Who can merge (default: 40=Maintainers) |
| `push_access_level` | integer | No | Who can push (default: 40=Maintainers) |
| `unprotect_access_level` | integer | No | Who can unprotect (default: 40=Maintainers) |

**Action `protect_tag`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Tag name or wildcard pattern (e.g., 'v*', 'release-*') |
| `allowed_to_create` | object[] | No | Granular create access (Premium feature) |
| `create_access_level` | integer | No | Who can create matching tags (default: 40=Maintainers) |

**Action `unprotect_branch`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Branch name or wildcard pattern to unprotect |

**Action `unprotect_tag`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Tag name or wildcard pattern to unprotect |

**Action `update_branch_protection`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Branch name or wildcard pattern |
| `allow_force_push` | boolean | No | Allow force push to protected branch |
| `allowed_to_merge` | object[] | No | Granular merge access (Premium feature) |
| `allowed_to_push` | object[] | No | Granular push access (Premium feature) |
| `allowed_to_unprotect` | object[] | No | Granular unprotect access (Premium feature) |
| `code_owner_approval_required` | boolean | No | Require code owner approval (Premium feature) |

#### Example

```json
{
  "action": "create_branch",
  "project_id": "my-group/my-project",
  "branch": "main",
  "ref": "main"
}
```

---

## Collaboration

### browse_users [tier: Free]

Find GitLab users with smart pattern detection. Actions: search (find users by name/email/username with transliteration support), get (retrieve specific user by ID). Related: browse_members for project/group membership.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `search` | Free | Search users with smart pattern detection |
| `get` | Free | Get a specific user by ID |

#### Parameters

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | User ID to retrieve. |

**Action `search`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `active` | boolean | No | Filter for active (true) or inactive (false) users. |
| `blocked` | boolean | No | Filter for blocked users. |
| `created_after` | string | No | Filter users created after this date (ISO 8601). |
| `created_before` | string | No | Filter users created before this date (ISO 8601). |
| `exclude_active` | boolean | No | Exclude active users. |
| `exclude_external` | boolean | No | Exclude external users. |
| `exclude_humans` | boolean | No | Exclude human users. |
| `exclude_internal` | boolean | No | Exclude internal system users. |
| `external` | boolean | No | Filter for external users with limited access. |
| `humans` | boolean | No | Filter for human users only (exclude bots). |
| `page` | integer | No | Page number |
| `public_email` | string | No | Find user by exact public email address. |
| `search` | string | No | Partial text search across name, username, and email. |
| `smart_search` | boolean | No | Enable smart search with auto-detection and transliteration. Auto-enabled for search parameter. |
| `username` | string | No | Exact username to search for. Case-sensitive. |
| `without_project_bots` | boolean | No | Exclude project bot users. |

#### Example

```json
{
  "action": "search",
  "per_page": 10
}
```

---

### browse_todos [tier: Free]

View your GitLab todo queue (notifications requiring action). Actions: list (filter by state, action type, target type). Todos are auto-created for assignments, mentions, reviews, and pipeline failures. Related: manage_todos to mark done/restore.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List your pending and completed todos |

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `author_id` | number | No | Filter by author ID. |
| `group_id` | number | No | Filter by group ID. |
| `page` | integer | No | Page number |
| `project_id` | number | No | Filter by project ID. |
| `state` | string | No | Filter todos by state: pending=active, done=completed. |
| `todo_action` | string | No | Filter by action type. |
| `type` | string | No | Filter by target type. |

#### Example

```json
{
  "action": "list",
  "per_page": 10
}
```

---

### manage_todos [tier: Free]

Manage your GitLab todo queue. Actions: mark_done (complete a single todo), mark_all_done (clear entire queue), restore (undo completion). Related: browse_todos to view your todo list.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `mark_done` | Free | Mark a single todo as done |
| `mark_all_done` | Free | Mark all todos as done (clears entire queue) |
| `restore` | Free | Restore a completed todo to pending state |

#### Parameters

**Action `mark_done`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | Yes | Todo ID to mark as done |

**Action `restore`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | Yes | Todo ID to restore |

#### Example

```json
{
  "action": "mark_done",
  "id": "123"
}
```

---

### browse_merge_requests [tier: Premium*]

Find and inspect merge requests. Actions: list (filter by state/author/reviewer/labels/branch), get (MR details by IID or source branch), diffs (file-level changes with inline suggestions), compare (diff between any two refs). Related: manage_merge_request to create/update/merge.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List merge requests with filtering |
| `get` | Free | Get single MR by IID or branch name |
| `diffs` | Free | Get file changes/diffs for an MR |
| `compare` | Free | Compare two branches or commits |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | No | Project ID or URL-encoded path. Optional for cross-project search. |

**Action `compare`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | string | Yes | Source reference: branch name or commit SHA |
| `to` | string | Yes | Target reference: branch name or commit SHA |
| `straight` | boolean | No | true=straight diff, false=three-way diff from common ancestor |

**Action `diffs`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `include_diverged_commits_count` | boolean | No | Include count of commits the source branch is behind target |
| `include_rebase_in_progress` | boolean | No | Check if MR is currently being rebased |
| `page` | integer | No | Page number |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `branch_name` | string | No | Find MR by its source branch name |
| `include_diverged_commits_count` | boolean | No | Include count of commits the source branch is behind target |
| `include_rebase_in_progress` | boolean | No | Check if MR is currently being rebased |
| `merge_request_iid` | string | No | Internal MR ID. Required unless branch_name provided. |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `approved_by_ids` | string[] | No | Filter MRs approved by user IDs |
| `approved_by_usernames` | string[] | No | Filter MRs approved by usernames |
| `assignee_id` | number | No | Filter by assignee's user ID |
| `assignee_username` | string | No | Filter by assignee's username |
| `author_id` | number | No | Filter by author's user ID |
| `author_username` | string | No | Filter by author's username |
| `created_after` | string | No | Filter MRs created after (ISO 8601) |
| `created_before` | string | No | Filter MRs created before (ISO 8601) |
| `deployed_after` | string | No | Filter MRs deployed after |
| `deployed_before` | string | No | Filter MRs deployed before |
| `environment` | string | No | Filter by deployment environment |
| `in` | string | No | Search scope |
| `labels` | string | string[] | No | Filter by labels |
| `milestone` | string | No | Filter by milestone title. Use "None" or "Any". |
| `min_access_level` | number | No | Minimum access level filter (10-50) |
| `my_reaction_emoji` | string | No | Filter MRs you've reacted to |
| `not` | object | No | Exclusion filters |
| `order_by` | string | No | Sort field |
| `page` | integer | No | Page number |
| `reviewer_id` | number | No | Filter by reviewer user ID |
| `reviewer_username` | string | No | Filter by reviewer username |
| `scope` | string | No | Filter scope |
| `search` | string | No | Text search in title/description |
| `sort` | string | No | Sort direction |
| `source_branch` | string | No | Filter by source branch |
| `state` | string | No | MR state filter |
| `target_branch` | string | No | Filter by target branch |
| `updated_after` | string | No | Filter MRs modified after (ISO 8601) |
| `updated_before` | string | No | Filter MRs modified before (ISO 8601) |
| `view` | string | No | Response detail level |
| `wip` | string | No | Draft/WIP filter |
| `with_api_entity_associations` | boolean | No | Include extra API associations |
| `with_labels_details` | boolean | No | Return full label objects |
| `with_merge_status_recheck` | boolean | No | Trigger async recheck of merge status |

#### Example

```json
{
  "action": "list",
  "per_page": 10
}
```

---

### browse_mr_discussions [tier: Free]

Read discussion threads and draft review notes on merge requests. Actions: list (all threads with resolution status), drafts (unpublished draft notes), draft (single draft details). Related: manage_mr_discussion to comment, manage_draft_notes to create drafts.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List all discussion threads on an MR |
| `drafts` | Free | List unpublished draft notes on an MR |
| `draft` | Free | Get single draft note details |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `draft`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `draft_note_id` | string | Yes | Unique identifier of the draft note |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |

#### Example

```json
{
  "action": "list",
  "project_id": "my-group/my-project",
  "merge_request_iid": "1",
  "per_page": 10
}
```

---

### manage_merge_request [tier: Premium*]

Create, update, merge, or approve merge requests. Actions: create (new MR from source to target), update (title/description/assignees/reviewers/labels), merge (into target branch), approve/unapprove (review approval), get_approval_state (current approvals). Related: browse_merge_requests for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new merge request |
| `update` | Free | Update an existing merge request |
| `merge` | Free | Merge an approved merge request |
| `approve` | Premium | Approve a merge request |
| `unapprove` | Premium | Remove your approval from a merge request |
| `get_approval_state` | Premium | Get current approval status and rules |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `approve`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `sha` | string | No | SHA of head commit to approve specific version |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_branch` | string | Yes | Branch containing changes to merge |
| `target_branch` | string | Yes | Branch to merge into |
| `title` | string | Yes | MR title/summary |
| `allow_collaboration` | boolean | No | Let maintainers push to source branch |
| `allow_maintainer_to_push` | boolean | No | Deprecated - use allow_collaboration |
| `assignee_id` | string | No | Single assignee user ID |
| `assignee_ids` | string[] | No | Multiple assignee IDs |
| `description` | string | No | MR description (Markdown) |
| `labels` | string | string[] | No | Labels to categorize MR |
| `milestone_id` | string | No | Associate MR with milestone |
| `remove_source_branch` | boolean | No | Auto-delete source branch after merge |
| `reviewer_ids` | string[] | No | User IDs for code reviewers |
| `squash` | boolean | No | Combine all commits into one when merging |
| `target_project_id` | string | No | Target project for cross-project MRs |

**Action `get_approval_state`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |

**Action `merge`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `merge_commit_message` | string | No | Custom merge commit message |
| `merge_when_pipeline_succeeds` | boolean | No | Merge when pipeline succeeds |
| `sha` | string | No | SHA of the head commit |
| `should_remove_source_branch` | boolean | No | Remove source branch after merge |
| `squash` | boolean | No | Combine all commits into one when merging |
| `squash_commit_message` | string | No | Custom squash commit message |

**Action `unapprove`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `add_labels` | string | string[] | No | Labels to add |
| `allow_collaboration` | boolean | No | Let maintainers push to source branch |
| `allow_maintainer_to_push` | boolean | No | Deprecated - use allow_collaboration |
| `assignee_id` | string | No | Single assignee user ID |
| `assignee_ids` | string[] | No | Multiple assignee IDs |
| `description` | string | No | MR description (Markdown) |
| `discussion_locked` | boolean | No | Lock discussion thread |
| `labels` | string | string[] | No | Labels to categorize MR |
| `milestone_id` | string | No | Associate MR with milestone |
| `remove_labels` | string | string[] | No | Labels to remove |
| `remove_source_branch` | boolean | No | Auto-delete source branch after merge |
| `reviewer_ids` | string[] | No | User IDs for code reviewers |
| `squash` | boolean | No | Combine all commits into one when merging |
| `state_event` | string | No | State event: close or reopen |
| `target_branch` | string | No | Branch to merge into |
| `title` | string | No | MR title/summary |

#### Example

```json
{
  "action": "create",
  "project_id": "my-group/my-project",
  "source_branch": "example_source_branch",
  "target_branch": "example_target_branch",
  "title": "Example title"
}
```

---

### manage_mr_discussion [tier: Free]

Post comments, start threads, and suggest code changes on merge requests. Actions: comment (simple note), thread (line-level discussion), reply (to existing thread), update (edit note text), resolve (toggle thread resolution), suggest (code suggestion block), apply_suggestion/apply_suggestions (accept code suggestions). Related: browse_mr_discussions to read threads.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `comment` | Free | Add a comment to an issue or merge request |
| `thread` | Free | Start a new discussion thread on an MR |
| `reply` | Free | Reply to an existing discussion thread |
| `update` | Free | Update an existing note/comment |
| `apply_suggestion` | Free | Apply a single code suggestion from a review |
| `apply_suggestions` | Free | Batch apply multiple code suggestions |
| `resolve` | Free | Resolve or unresolve a discussion thread |
| `suggest` | Free | Create a code suggestion on a diff line |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `apply_suggestion`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `suggestion_id` | number | Yes | ID of the suggestion to apply |
| `commit_message` | string | No | Custom commit message for the apply commit |

**Action `apply_suggestions`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `suggestion_ids` | number[] | Yes | Array of suggestion IDs to apply |
| `commit_message` | string | No | Custom commit message for the apply commit |

**Action `comment`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `body` | string | Yes | Content/text of the comment |
| `noteable_id` | string | Yes | ID of the noteable object |
| `noteable_type` | string | Yes | Type of noteable: issue or merge_request |
| `confidential` | boolean | No | Confidential note flag |
| `created_at` | string | No | Date time string (ISO 8601) |

**Action `reply`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `body` | string | Yes | Content/text of the reply |
| `discussion_id` | string | Yes | ID of the discussion to reply to |
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `created_at` | string | No | Date time string (ISO 8601) |

**Action `resolve`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `discussion_id` | string | Yes | ID of the discussion thread to resolve/unresolve |
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `resolved` | boolean | Yes | true to resolve, false to unresolve |

**Action `suggest`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `lines_above` | integer | Yes | Lines to include above (default: 0) |
| `lines_below` | integer | Yes | Lines to include below (default: 0) |
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `position` | object | Yes | Position in diff for the suggestion (requires base_sha, head_sha, start_sha, new_path, new_line) |
| `suggestion` | string | Yes | The suggested code (raw code, no markdown formatting needed) |
| `comment` | string | No | Optional explanation comment before the suggestion |

**Action `thread`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `body` | string | Yes | Content/text of the thread |
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `commit_id` | string | No | SHA of commit to start discussion on |
| `position` | object | No | Position for diff note |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `body` | string | Yes | New content/text for the note |
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `note_id` | string | Yes | ID of the note to update |

#### Example

```json
{
  "action": "comment",
  "project_id": "my-group/my-project",
  "noteable_type": "issue",
  "noteable_id": "123",
  "body": "example_body"
}
```

---

### manage_draft_notes [tier: Free]

Create and manage unpublished review comments on merge requests. Actions: create (new draft), update (modify text), publish (make single draft visible), publish_all (submit entire review), delete (discard draft). Related: browse_mr_discussions action 'drafts' to list existing drafts.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new draft note |
| `update` | Free | Update an existing draft note |
| `publish` | Free | Publish a single draft note |
| `publish_all` | Free | Publish all draft notes at once |
| `delete` | Free | Delete a draft note |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `merge_request_iid` | string | Yes | Internal MR ID unique to project |
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `note` | string | Yes | Content of the draft note |
| `commit_id` | string | No | SHA of commit to start discussion on |
| `in_reply_to_discussion_id` | string | No | Discussion ID to reply to |
| `position` | object | No | Position for diff note |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `draft_note_id` | string | Yes | ID of the draft note |

**Action `publish`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `draft_note_id` | string | Yes | ID of the draft note |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `draft_note_id` | string | Yes | ID of the draft note |
| `note` | string | Yes | New content for the draft note |
| `position` | object | No | Position for diff note |

#### Example

```json
{
  "action": "create",
  "project_id": "my-group/my-project",
  "merge_request_iid": "1",
  "note": "example_note"
}
```

---

### browse_members [tier: Free]

View team members and access levels in projects or groups. Actions: list_project, list_group, get_project, get_group (direct members), list_all_project, list_all_group (includes inherited). Levels: Guest(10), Reporter(20), Developer(30), Maintainer(40), Owner(50). Related: manage_member to add/remove, browse_users to find users by name.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list_project` | Free | List all members of a project |
| `list_group` | Free | List all members of a group |
| `get_project` | Free | Get a specific member of a project |
| `get_group` | Free | Get a specific member of a group |
| `list_all_project` | Free | List all project members including inherited from parent groups |
| `list_all_group` | Free | List all group members including inherited from parent groups |

#### Parameters

**Action `get_group`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `group_id` | string | Yes | Group ID or URL-encoded path |
| `user_id` | string | Yes | User ID of the member |
| `include_inherited` | boolean | No | Include members inherited from parent groups |

**Action `get_project`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |
| `user_id` | string | Yes | User ID of the member |
| `include_inherited` | boolean | No | Include members inherited from parent groups |

**Action `list_all_group`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `group_id` | string | Yes | Group ID or URL-encoded path |
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |
| `query` | string | No | Search members by name or username |
| `state` | string | No | Filter by member state |
| `user_ids` | string[] | No | Filter to specific user IDs |

**Action `list_all_project`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `project_id` | string | Yes | Project ID or URL-encoded path |
| `page` | integer | No | Page number |
| `query` | string | No | Search members by name or username |
| `state` | string | No | Filter by member state |
| `user_ids` | string[] | No | Filter to specific user IDs |

**Action `list_group`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `group_id` | string | Yes | Group ID or URL-encoded path |
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |
| `query` | string | No | Search members by name or username |
| `user_ids` | string[] | No | Filter to specific user IDs |

**Action `list_project`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `project_id` | string | Yes | Project ID or URL-encoded path |
| `page` | integer | No | Page number |
| `query` | string | No | Search members by name or username |
| `user_ids` | string[] | No | Filter to specific user IDs |

#### Example

```json
{
  "action": "list_project",
  "project_id": "my-group/my-project",
  "per_page": 10
}
```

---

### manage_member [tier: Free]

Add, remove, or update access levels for project/group members. Actions: add_to_project, add_to_group (with access level + optional expiry), remove_from_project, remove_from_group, update_project, update_group (change access level). Related: browse_members for current membership.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `add_to_project` | Free | Add a user as member to a project |
| `add_to_group` | Free | Add a user as member to a group |
| `remove_from_project` | Free | Remove a member from a project |
| `remove_from_group` | Free | Remove a member from a group |
| `update_project` | Free | Update access level of a project member |
| `update_group` | Free | Update access level of a group member |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | Yes | User ID to remove |

**Action `add_to_group`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `access_level` | integer | Yes | Access level: 0=No access, 5=Minimal, 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner |
| `group_id` | string | Yes | Group ID or URL-encoded path |
| `expires_at` | string | No | Membership expiration date in ISO 8601 format (YYYY-MM-DD) |

**Action `add_to_project`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `access_level` | integer | Yes | Access level: 0=No access, 5=Minimal, 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner |
| `project_id` | string | Yes | Project ID or URL-encoded path |
| `expires_at` | string | No | Membership expiration date in ISO 8601 format (YYYY-MM-DD) |

**Action `remove_from_group`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `group_id` | string | Yes | Group ID or URL-encoded path |
| `skip_subresources` | boolean | No | Skip removing from subgroups and projects |
| `unassign_issuables` | boolean | No | Unassign member from issues and merge requests |

**Action `remove_from_project`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |
| `skip_subresources` | boolean | No | Skip removing from subprojects and forks |
| `unassign_issuables` | boolean | No | Unassign member from issues and merge requests |

**Action `update_group`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `access_level` | integer | Yes | Access level: 0=No access, 5=Minimal, 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner |
| `group_id` | string | Yes | Group ID or URL-encoded path |
| `expires_at` | string | No | Membership expiration date in ISO 8601 format (YYYY-MM-DD) |
| `member_role_id` | integer | No | ID of a custom member role (Ultimate only) |

**Action `update_project`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `access_level` | integer | Yes | Access level: 0=No access, 5=Minimal, 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner |
| `project_id` | string | Yes | Project ID or URL-encoded path |
| `expires_at` | string | No | Membership expiration date in ISO 8601 format (YYYY-MM-DD) |

#### Example

```json
{
  "action": "add_to_project",
  "project_id": "my-group/my-project",
  "user_id": "123",
  "access_level": 10
}
```

---

## Planning

### browse_labels [tier: Free]

List and inspect project or group labels. Actions: list (all labels with search filtering), get (single label by ID or name). Related: manage_label to create/update/delete.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List labels with optional filtering |
| `get` | Free | Get a single label by ID or title |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | Namespace path (group or project) |
| `include_ancestor_groups` | boolean | No | Include ancestor groups when listing or getting labels |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `label_id` | string | Yes | The ID or title of the label |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |
| `search` | string | No | Keyword to filter labels by |
| `with_counts` | boolean | No | Include issue and merge request counts |

#### Example

```json
{
  "action": "list",
  "namespace": "my-group/my-project",
  "per_page": 10
}
```

---

### manage_label [tier: Free]

Create, update, or delete project/group labels. Actions: create (name + hex color required), update (modify properties), delete (remove permanently). Related: browse_labels for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new label |
| `update` | Free | Update an existing label |
| `delete` | Free | Delete a label |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | Namespace path (group or project) |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `color` | string | Yes | The color of the label in 6-digit hex notation with leading '#' (e.g. #FFAABB) or CSS color name |
| `name` | string | Yes | The name of the label |
| `description` | string | No | The description of the label |
| `priority` | number | No | The priority of the label. Must be greater or equal than zero or null to remove the priority. |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `label_id` | string | Yes | The ID or title of the label |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `label_id` | string | Yes | The ID or title of the label |
| `color` | string | No | The color of the label in 6-digit hex notation with leading '#' (e.g. #FFAABB) or CSS color name |
| `description` | string | No | The description of the label |
| `name` | string | No | The name of the label |
| `new_name` | string | No | The new name of the label |
| `priority` | number | No | The priority of the label. Must be greater or equal than zero or null to remove the priority. |

#### Example

```json
{
  "action": "create",
  "namespace": "my-group/my-project",
  "name": "example_name",
  "color": "example_color"
}
```

---

### browse_milestones [tier: Premium*]

Track milestone progress with associated issues and MRs. Actions: list (filter by state/title/search), get (milestone details), issues (items in milestone), merge_requests (MRs targeting milestone), burndown (chart data for sprint tracking). Related: manage_milestone to create/update.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List milestones with optional filtering |
| `get` | Free | Get a single milestone by ID |
| `issues` | Free | List issues assigned to a milestone |
| `merge_requests` | Free | List merge requests assigned to a milestone |
| `burndown` | Premium | Get burndown chart data for a milestone |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | Namespace path (group or project) |

**Action `burndown`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `milestone_id` | string | Yes | The ID of a project or group milestone. Required for 'get', 'issues', 'merge_requests', 'burndown' action(s). |
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `milestone_id` | string | Yes | The ID of a project or group milestone. Required for 'get', 'issues', 'merge_requests', 'burndown' action(s). |

**Action `issues`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `milestone_id` | string | Yes | The ID of a project or group milestone. Required for 'get', 'issues', 'merge_requests', 'burndown' action(s). |
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `iids` | string[] | No | Return only the milestones having the given iid |
| `include_ancestors` | boolean | No | Include ancestor groups |
| `page` | integer | No | Page number |
| `search` | string | No | Return only milestones with a title or description matching the provided string |
| `state` | string | No | Return only active or closed milestones |
| `title` | string | No | Return only milestones with a title matching the provided string |
| `updated_after` | string | No | Return milestones updated after the specified date (ISO 8601 format) |
| `updated_before` | string | No | Return milestones updated before the specified date (ISO 8601 format) |

**Action `merge_requests`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `milestone_id` | string | Yes | The ID of a project or group milestone. Required for 'get', 'issues', 'merge_requests', 'burndown' action(s). |
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |

#### Example

```json
{
  "action": "list",
  "namespace": "my-group/my-project",
  "per_page": 10
}
```

---

### manage_milestone [tier: Free]

Create, update, or delete project/group milestones. Actions: create (title + optional dates/description), update (modify properties or close/activate), delete (remove permanently), promote (elevate project milestone to group). Related: browse_milestones for progress tracking.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new item |
| `update` | Free | Update an existing item |
| `delete` | Free | Delete an item |
| `promote` | Free | Perform promote operation |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | Namespace path (group or project) |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | The title of the milestone |
| `description` | string | No | The description of the milestone |
| `due_date` | string | No | The due date of the milestone (YYYY-MM-DD) |
| `start_date` | string | No | The start date of the milestone (YYYY-MM-DD) |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `milestone_id` | string | Yes | The ID of a project or group milestone. Required for 'update', 'delete', 'promote' action(s). |

**Action `promote`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `milestone_id` | string | Yes | The ID of a project or group milestone. Required for 'update', 'delete', 'promote' action(s). |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `milestone_id` | string | Yes | The ID of a project or group milestone. Required for 'update', 'delete', 'promote' action(s). |
| `description` | string | No | The new description of the milestone |
| `due_date` | string | No | The due date of the milestone (YYYY-MM-DD) |
| `start_date` | string | No | The start date of the milestone (YYYY-MM-DD) |
| `state_event` | string | No | State event to apply: 'close' or 'activate' |
| `title` | string | No | The new title of the milestone |

#### Example

```json
{
  "action": "create",
  "namespace": "my-group/my-project",
  "title": "Example title"
}
```

---

### browse_work_items [tier: Free]

Find and inspect issues, epics, tasks, and other work items. Actions: list (groups return epics, projects return issues/tasks, filter by type/state/labels), get (by numeric ID or namespace+iid from URL path). Related: manage_work_item to create/update/delete.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List work items with filtering |
| `get` | Free | Get single work item details |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | No | Namespace path (group or project). Groups return epics, projects return issues/tasks. |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | No | Work item ID to retrieve - use numeric ID from list results (e.g., '5953') |
| `iid` | string | No | Internal ID from URL (e.g., '95' from /issues/95). Use with namespace parameter. |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `first` | number | Yes | Number of items to return |
| `simple` | boolean | Yes | Return simplified structure with essential fields only. RECOMMENDED: Use default true for most cases. |
| `state` | string[] | Yes | Filter by work item state. Defaults to OPEN items only. Use ["OPEN", "CLOSED"] for all items. |
| `after` | string | No | Cursor for pagination (use endCursor from previous response) |
| `types` | string[] | No | Filter by work item types |

#### Example

```json
{
  "action": "list",
  "namespace": "my-group/my-project",
  "state": [],
  "first": 10,
  "simple": true
}
```

---

### manage_work_item [tier: Free]

Create, update, delete, or link work items (issues, epics, tasks). Actions: create (epics need GROUP namespace, issues/tasks need PROJECT), update (widgets: dates, time tracking, weight, iterations, health, progress, hierarchy), delete (permanent), add_link/remove_link (BLOCKS/BLOCKED_BY/RELATED). Related: browse_work_items for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new work item |
| `update` | Free | Update an existing work item |
| `delete` | Free | Delete a work item |
| `add_link` | Free | Add a relationship link between two work items |
| `remove_link` | Free | Remove a relationship link between two work items |

#### Parameters

**Action `add_link`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Source work item ID |
| `linkType` | string | Yes | Relationship type: BLOCKS (this blocks target), BLOCKED_BY (this is blocked by target), RELATED (general relationship) |
| `targetId` | string | Yes | Target work item ID to link to |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | CRITICAL: Namespace path (group OR project). For Epics use GROUP path (e.g. "my-group"). For Issues/Tasks use PROJECT path (e.g. "my-group/my-project"). |
| `title` | string | Yes | Title of the work item |
| `workItemType` | string | Yes | Type of work item |
| `assigneeIds` | string[] | No | Array of assignee user IDs |
| `childrenIds` | string[] | No | Array of child work item IDs to add |
| `color` | string | No | Custom hex color for epics (Ultimate tier) |
| `description` | string | No | Description of the work item |
| `dueDate` | string | No | Due date in YYYY-MM-DD format |
| `healthStatus` | string | No | Health status indicator (Ultimate tier) |
| `isFixed` | boolean | No | Fixed dates - not inherited from children (Premium tier) |
| `iterationId` | string | No | Iteration/sprint ID to assign (Premium tier) |
| `labelIds` | string[] | No | Array of label IDs |
| `milestoneId` | string | No | Milestone ID |
| `parentId` | string | No | Parent work item ID to set hierarchy relationship |
| `progressCurrentValue` | integer | No | Current progress value 0-100 for OKR key results (Premium tier) |
| `startDate` | string | No | Start date in YYYY-MM-DD format |
| `timeEstimate` | string | No | Time estimate in human-readable format (e.g. "1h 30m", "2d") |
| `weight` | integer | No | Story points / weight value (Premium tier) |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Work item ID - use numeric ID from list results (e.g., '5953') |

**Action `remove_link`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Source work item ID |
| `linkType` | string | Yes | Relationship type: BLOCKS (this blocks target), BLOCKED_BY (this is blocked by target), RELATED (general relationship) |
| `targetId` | string | Yes | Target work item ID to unlink |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Work item ID - use numeric ID from list results (e.g., '5953') |
| `assigneeIds` | string[] | No | Array of assignee user IDs |
| `childrenIds` | string[] | No | Array of child work item IDs to add |
| `color` | string | No | Custom hex color for epics (Ultimate tier) |
| `description` | string | No | Description of the work item |
| `dueDate` | string | null | No | Due date in YYYY-MM-DD format (null to clear) |
| `healthStatus` | string | null | No | Health status indicator, null to clear (Ultimate tier) |
| `isFixed` | boolean | No | Fixed dates - not inherited from children (Premium tier) |
| `iterationId` | string | null | No | Iteration/sprint ID, null to unassign (Premium tier) |
| `labelIds` | string[] | No | Array of label IDs |
| `milestoneId` | string | No | Milestone ID |
| `parentId` | string | null | No | Parent work item ID (null to unlink parent) |
| `progressCurrentValue` | integer | No | Current progress value 0-100 for OKR key results (Premium tier) |
| `startDate` | string | null | No | Start date in YYYY-MM-DD format (null to clear) |
| `state` | string | No | State event for the work item (CLOSE, REOPEN) |
| `timeEstimate` | string | No | Time estimate in human-readable format (e.g. "1h 30m", "2d", "0h" to clear) |
| `timeSpent` | string | No | Time spent to log as timelog entry (e.g. "2h", "1h 30m") |
| `timeSpentAt` | string | No | When time was spent in ISO 8601 format (defaults to now) |
| `timeSpentSummary` | string | No | Summary/description of work done for the timelog entry |
| `title` | string | No | Title of the work item |
| `weight` | integer | null | No | Story points / weight value, null to clear (Premium tier) |

#### Example

```json
{
  "action": "create",
  "namespace": "my-group/my-project",
  "workItemType": "EPIC",
  "title": "Example title"
}
```

---

### browse_iterations [tier: Premium]

View group iterations for agile sprint planning. Actions: list (filter by state: current, upcoming, closed), get (retrieve specific iteration details). Related: browse_work_items for items in an iteration.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Premium | List iterations for a group |
| `get` | Premium | Get a specific iteration by ID |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `group_id` | string | Yes | Group ID or URL-encoded path. |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `iteration_id` | string | Yes | Iteration ID. |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `include_ancestors` | boolean | No | Include iterations from parent groups. |
| `page` | integer | No | Page number |
| `search` | string | No | Search iterations by title. |
| `state` | string | No | Filter by iteration state. |

#### Example

```json
{
  "action": "list",
  "group_id": "my-group",
  "per_page": 10
}
```

---

## CI/CD

### browse_pipelines [tier: Free]

Monitor CI/CD pipelines and read job logs. Actions: list (filter by status/ref/source/username), get (pipeline details), jobs (list pipeline jobs), triggers (bridge/trigger jobs), job (single job details), logs (job console output). Related: manage_pipeline to trigger/retry/cancel, manage_pipeline_job for individual jobs.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List pipelines with filtering |
| `get` | Free | Get single pipeline details |
| `jobs` | Free | List jobs in a pipeline |
| `triggers` | Free | List bridge/trigger jobs in a pipeline |
| `job` | Free | Get single job details |
| `logs` | Free | Get job console output/logs |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipeline_id` | string | Yes | The ID of the pipeline |

**Action `job`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `job_id` | string | Yes | The ID of the job |

**Action `jobs`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `pipeline_id` | string | Yes | The ID of the pipeline |
| `include_retried` | boolean | No | Include retried jobs in the response |
| `job_scope` | string[] | No | Scope of jobs to show |
| `page` | integer | No | Page number |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `name` | string | No | Filter by name of user who triggered pipeline |
| `order_by` | string | No | Order pipelines by |
| `page` | integer | No | Page number |
| `ref` | string | No | Filter by branch or tag ref |
| `scope` | string | No | Pipeline scope filter |
| `sha` | string | No | Filter by SHA |
| `sort` | string | No | Sort order |
| `source` | string | No | Pipeline source filter |
| `status` | string | No | Pipeline status filter |
| `updated_after` | string | No | ISO 8601 datetime to filter by updated_after |
| `updated_before` | string | No | ISO 8601 datetime to filter by updated_before |
| `username` | string | No | Filter by username who triggered pipeline |
| `yaml_errors` | boolean | No | Filter by YAML errors |

**Action `logs`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `job_id` | string | Yes | The ID of the job |
| `limit` | number | No | Maximum number of lines to return. Combined with start, acts as line count |
| `max_lines` | number | No | Maximum number of lines to return (alternative to limit) |
| `start` | number | No | Start from specific line number (0-based). Positive from beginning, negative from end (e.g., -100 = last 100 lines) |

**Action `triggers`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `pipeline_id` | string | Yes | The ID of the pipeline |
| `include_retried` | boolean | No | Include retried jobs in the response |
| `page` | integer | No | Page number |
| `trigger_scope` | string[] | No | Scope of trigger jobs to show |

#### Example

```json
{
  "action": "list",
  "project_id": "my-group/my-project",
  "per_page": 10
}
```

---

### manage_pipeline [tier: Free]

Trigger, retry, or cancel CI/CD pipelines. Actions: create (run pipeline on ref with variables), retry (re-run failed jobs), cancel (stop running pipeline). Related: browse_pipelines for monitoring.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Trigger a new pipeline on branch/tag |
| `retry` | Free | Re-run a failed/canceled pipeline |
| `cancel` | Free | Stop a running pipeline |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `cancel`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipeline_id` | string | Yes | The ID of the pipeline |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ref` | string | Yes | The branch or tag to run the pipeline on |
| `variables` | object[] | No | Variables to pass to the pipeline |

**Action `retry`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipeline_id` | string | Yes | The ID of the pipeline |

#### Example

```json
{
  "action": "create",
  "project_id": "my-group/my-project",
  "ref": "main"
}
```

---

### manage_pipeline_job [tier: Free]

Control individual CI/CD jobs within a pipeline. Actions: play (trigger manual/delayed job with variables), retry (re-run single job), cancel (stop running job). Related: browse_pipelines actions 'job'/'logs' for job details.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `play` | Free | Trigger a manual job |
| `retry` | Free | Re-run a failed/canceled job |
| `cancel` | Free | Stop a running job |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `job_id` | string | Yes | The ID of the job |
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `cancel`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | boolean | No | Force cancellation of the job |

**Action `play`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `job_variables_attributes` | object[] | No | Variables to pass to the job |

#### Example

```json
{
  "action": "play",
  "project_id": "my-group/my-project",
  "job_id": "123"
}
```

---

### browse_variables [tier: Free]

List and inspect CI/CD variables for projects or groups. Actions: list (all variables with pagination), get (single variable by key with environment scope filter). Related: manage_variable to create/update/delete.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List all CI/CD variables |
| `get` | Free | Get a single CI/CD variable by key |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | Namespace path (group or project) |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | The key of the CI/CD variable. Maximum 255 characters, alphanumeric and underscore only. |
| `filter` | object | No | Filter parameters for variable lookup |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |

#### Example

```json
{
  "action": "list",
  "namespace": "my-group/my-project",
  "per_page": 10
}
```

---

### manage_variable [tier: Free]

Create, update, or delete CI/CD variables with environment scoping. Actions: create (key + value, set scope/protection/masking), update (modify value or settings), delete (remove permanently). Related: browse_variables for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new CI/CD variable |
| `update` | Free | Update an existing CI/CD variable |
| `delete` | Free | Delete a CI/CD variable |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | The key of the CI/CD variable. Maximum 255 characters, only alphanumeric and underscore characters allowed. |
| `namespace` | string | Yes | Namespace path (group or project) |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `value` | string | Yes | The value of the CI/CD variable. For file type variables, this is the file content. |
| `description` | string | No | Optional description explaining the purpose of this variable (GitLab 16.2+). |
| `environment_scope` | string | No | The environment scope. Use "*" for all environments (default), or specify like "production", "staging". |
| `masked` | boolean | No | Whether this variable should be masked in job logs. MASKING REQUIREMENTS: Value must be at least 8 characters, single line with no spaces, only A-Z a-z 0-9 + / = . ~ - _ @ : characters. |
| `protected` | boolean | No | Whether this variable is protected. Protected variables are only available to protected branches/tags. |
| `raw` | boolean | No | Whether variable expansion is disabled. When true, variables like $OTHER_VAR in the value will NOT be expanded. |
| `variable_type` | string | No | The type of variable: "env_var" for environment variables (default) or "file" for file variables. |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filter` | object | No | Filter parameters to identify the specific variable |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | No | Optional description explaining the purpose of this variable (GitLab 16.2+). |
| `environment_scope` | string | No | The environment scope. Use "*" for all environments (default), or specify like "production", "staging". |
| `filter` | object | No | Filter parameters to identify the specific variable |
| `masked` | boolean | No | Whether this variable should be masked in job logs. MASKING REQUIREMENTS: Value must be at least 8 characters, single line with no spaces, only A-Z a-z 0-9 + / = . ~ - _ @ : characters. |
| `protected` | boolean | No | Whether this variable is protected. Protected variables are only available to protected branches/tags. |
| `raw` | boolean | No | Whether variable expansion is disabled. When true, variables like $OTHER_VAR in the value will NOT be expanded. |
| `value` | string | No | The value of the CI/CD variable. For file type variables, this is the file content. |
| `variable_type` | string | No | The type of variable: "env_var" for environment variables (default) or "file" for file variables. |

#### Example

```json
{
  "action": "create",
  "namespace": "my-group/my-project",
  "key": "example_key",
  "value": "example_value"
}
```

---

## Integrations & Content

### browse_wiki [tier: Free]

Read wiki pages in projects or groups. Actions: list (all pages with metadata), get (page content by slug). Related: manage_wiki to create/update/delete.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List all wiki pages |
| `get` | Free | Get a single wiki page by slug |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | Namespace path (group or project) |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | URL-encoded slug of the wiki page |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |
| `with_content` | boolean | No | Include content of the wiki pages |

#### Example

```json
{
  "action": "list",
  "namespace": "my-group/my-project",
  "per_page": 10
}
```

---

### manage_wiki [tier: Free]

Create, update, or delete wiki pages. Actions: create (new page with title/content/format), update (modify content or title), delete (remove permanently). Related: browse_wiki to read pages.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new wiki page |
| `update` | Free | Update an existing wiki page |
| `delete` | Free | Delete a wiki page |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | Yes | Namespace path (group or project) |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | Content of the wiki page |
| `title` | string | Yes | Title of the wiki page |
| `format` | string | No | Content format (markdown, rdoc, asciidoc, org). Defaults to markdown. |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | URL-encoded slug of the wiki page |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | URL-encoded slug of the wiki page |
| `content` | string | No | New content of the wiki page |
| `format` | string | No | Content format (markdown, rdoc, asciidoc, org). Defaults to markdown. |
| `title` | string | No | New title of the wiki page |

#### Example

```json
{
  "action": "create",
  "namespace": "my-group/my-project",
  "title": "Example title",
  "content": "File content here"
}
```

---

### browse_snippets [tier: Free]

Find and read code snippets with versioning support. Actions: list (personal/project/public scope with filtering), get (snippet metadata or raw file content). Related: manage_snippet to create/update.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List snippets with filtering by scope and visibility |
| `get` | Free | Get single snippet details or raw content |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | No | Project ID or URL-encoded path. Required for project snippets, leave empty for personal snippets |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | The ID of the snippet to retrieve |
| `raw` | boolean | Yes | Return raw content of snippet files instead of metadata |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `scope` | string | Yes | Scope of snippets: "personal" for current user, "project" for project-specific (requires projectId), "public" for all public snippets |
| `created_after` | string | No | Return snippets created after this date (ISO 8601). Example: '2024-01-01T00:00:00Z' |
| `created_before` | string | No | Return snippets created before this date (ISO 8601). Example: '2024-12-31T23:59:59Z' |
| `page` | integer | No | Page number |
| `visibility` | string | No | Filter by visibility: private (author only), internal (authenticated users), public (everyone) |

#### Example

```json
{
  "action": "list",
  "scope": "personal",
  "per_page": 10
}
```

---

### manage_snippet [tier: Free]

Create, update, or delete code snippets with multi-file support. Actions: create (new snippet with files and visibility), update (modify content/metadata, file operations), delete (remove permanently). Related: browse_snippets for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new snippet with one or more files |
| `update` | Free | Update an existing snippet metadata or files |
| `delete` | Free | Permanently delete a snippet |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | No | Project ID or URL-encoded path to create a project snippet. Leave empty for personal snippet |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | object[] | Yes | Array of files to include. At least one file required. Each needs file_path and content |
| `title` | string | Yes | The title of the snippet. Displayed in snippet list and as page title. Max 255 chars |
| `visibility` | string | Yes | Visibility: 'private' (author only), 'internal' (authenticated users), 'public' (everyone). Defaults to 'private' |
| `description` | string | No | Optional description explaining the snippet purpose. Supports markdown |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | The ID of the snippet to delete. This operation cannot be undone |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | The ID of the snippet to update |
| `description` | string | No | Update the snippet description. Supports markdown |
| `files` | object[] | No | Array of file operations. Each file must specify 'action': create/update/delete/move. Move requires previous_path |
| `title` | string | No | Update the snippet title. Max 255 chars |
| `visibility` | string | No | Update the visibility level |

#### Example

```json
{
  "action": "create",
  "title": "Example title",
  "visibility": "private",
  "files": []
}
```

---

### browse_webhooks [tier: Free]

List and inspect webhook configurations for projects or groups. Actions: list (all webhooks with event types and status), get (webhook details by ID). Related: manage_webhook to create/update/delete/test.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List all webhooks for a project or group |
| `get` | Free | Get webhook details by ID |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string | Yes | Scope of webhook (project or group) |
| `groupId` | string | No | Group ID or path (required if scope=group) |
| `projectId` | string | No | Project ID or path (required if scope=project) |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hookId` | string | Yes | Webhook ID (required) |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |

#### Example

```json
{
  "action": "list",
  "scope": "project",
  "per_page": 10
}
```

---

### manage_webhook [tier: Premium*]

Create, update, delete, or test webhooks for event-driven automation. Actions: create (URL + event types + optional secret), update (modify settings), delete (remove), test (trigger delivery for specific event). Related: browse_webhooks for inspection.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `create` | Free | Create a new item |
| `update` | Free | Update an existing item |
| `delete` | Free | Delete an item |
| `test` | Free | Test a webhook |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string | Yes | Scope of webhook (project or group) |
| `groupId` | string | No | Group ID or path (required if scope=group) |
| `projectId` | string | No | Project ID or path (required if scope=project) |

**Action `create`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Webhook URL (required) |
| `confidential_issues_events` | boolean | No | Enable confidential issue events |
| `confidential_note_events` | boolean | No | Enable confidential note events |
| `deployment_events` | boolean | No | Enable deployment events |
| `description` | string | No | Webhook description (GitLab 16.11+) |
| `emoji_events` | boolean | No | Enable emoji events |
| `enable_ssl_verification` | boolean | No | Enable SSL certificate verification |
| `feature_flag_events` | boolean | No | Enable feature flag events |
| `issues_events` | boolean | No | Enable issue events |
| `job_events` | boolean | No | Enable job/build events |
| `member_events` | boolean | No | Enable member events |
| `merge_requests_events` | boolean | No | Enable merge request events |
| `name` | string | No | Human-readable webhook name (GitLab 16.11+) |
| `note_events` | boolean | No | Enable note/comment events |
| `pipeline_events` | boolean | No | Enable pipeline events |
| `project_events` | boolean | No | Enable project events (group webhooks only) |
| `push_events` | boolean | No | Enable push events |
| `push_events_branch_filter` | string | No | Branch filter for push events (wildcard supported) |
| `releases_events` | boolean | No | Enable release events |
| `resource_access_token_events` | boolean | No | Enable resource access token events |
| `subgroup_events` | boolean | No | Enable subgroup events (group webhooks only) |
| `tag_push_events` | boolean | No | Enable tag push events |
| `token` | string | No | Secret token for webhook validation |
| `wiki_page_events` | boolean | No | Enable wiki page events |

**Action `delete`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hookId` | string | Yes | Webhook ID (required) |

**Action `test`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hookId` | string | Yes | Webhook ID (required) |
| `trigger` | string | Yes | Event type to test (required) |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hookId` | string | Yes | Webhook ID (required) |
| `confidential_issues_events` | boolean | No | Enable confidential issue events |
| `confidential_note_events` | boolean | No | Enable confidential note events |
| `deployment_events` | boolean | No | Enable deployment events |
| `description` | string | No | Webhook description (GitLab 16.11+) |
| `emoji_events` | boolean | No | Enable emoji events |
| `enable_ssl_verification` | boolean | No | Enable SSL certificate verification |
| `feature_flag_events` | boolean | No | Enable feature flag events |
| `issues_events` | boolean | No | Enable issue events |
| `job_events` | boolean | No | Enable job/build events |
| `member_events` | boolean | No | Enable member events |
| `merge_requests_events` | boolean | No | Enable merge request events |
| `name` | string | No | Human-readable webhook name (GitLab 16.11+) |
| `note_events` | boolean | No | Enable note/comment events |
| `pipeline_events` | boolean | No | Enable pipeline events |
| `project_events` | boolean | No | Enable project events (group webhooks only) |
| `push_events` | boolean | No | Enable push events |
| `push_events_branch_filter` | string | No | Branch filter for push events (wildcard supported) |
| `releases_events` | boolean | No | Enable release events |
| `resource_access_token_events` | boolean | No | Enable resource access token events |
| `subgroup_events` | boolean | No | Enable subgroup events (group webhooks only) |
| `tag_push_events` | boolean | No | Enable tag push events |
| `token` | string | No | Secret token for webhook validation |
| `url` | string | No | Webhook URL |
| `wiki_page_events` | boolean | No | Enable wiki page events |

#### Example

```json
{
  "action": "create",
  "scope": "project",
  "url": "https://example.com/webhook"
}
```

---

### browse_integrations [tier: Free]

Discover active project integrations and their configuration. Actions: list (all active: Slack, Jira, Discord, Teams, Jenkins, etc.), get (specific integration settings by slug). Related: manage_integration to configure/disable.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `list` | Free | List all active integrations for a project |
| `get` | Free | Get integration settings (read-only) |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `get`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `integration` | string | Yes | Integration type slug (e.g., slack, jira, discord). Note: gitlab-slack-application cannot be created via API - it requires OAuth installation from GitLab UI. |

**Action `list`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `page` | integer | No | Page number |

#### Example

```json
{
  "action": "list",
  "project_id": "my-group/my-project",
  "per_page": 10
}
```

---

### manage_integration [tier: Free]

Configure or disable project integrations (50+ supported). Actions: update (enable/modify with integration-specific config), disable (deactivate integration). Note: gitlab-slack-application requires OAuth install from GitLab UI. Related: browse_integrations for discovery.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `update` | Free | Update or enable integration with specific config |
| `disable` | Free | Disable and remove integration |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `integration` | string | Yes | Integration type slug (e.g., slack, jira, discord). Note: gitlab-slack-application cannot be created via API - it requires OAuth installation from GitLab UI. |
| `project_id` | string | Yes | Project ID or URL-encoded path |

**Action `update`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `active` | boolean | No | Enable or disable the integration without full configuration |
| `confidential_issues_events` | boolean | No | Trigger integration on confidential issue events |
| `config` | object | No | Integration-specific configuration parameters. Pass as key-value pairs. Examples: webhook_url, token, channel, etc. See GitLab API documentation for integration-specific fields. |
| `deployment_events` | boolean | No | Trigger integration on deployment events |
| `issues_events` | boolean | No | Trigger integration on issue events |
| `job_events` | boolean | No | Trigger integration on job events |
| `merge_requests_events` | boolean | No | Trigger integration on merge request events |
| `note_events` | boolean | No | Trigger integration on note events |
| `pipeline_events` | boolean | No | Trigger integration on pipeline events |
| `push_events` | boolean | No | Trigger integration on push events |
| `releases_events` | boolean | No | Trigger integration on release events |
| `tag_push_events` | boolean | No | Trigger integration on tag push events |
| `vulnerability_events` | boolean | No | Trigger integration on vulnerability events |
| `wiki_page_events` | boolean | No | Trigger integration on wiki page events |

#### Example

```json
{
  "action": "update",
  "project_id": "my-group/my-project",
  "integration": "slack"
}
```

---

## Discovery

### browse_search [tier: Free]

Search across GitLab resources globally or within a scope. Actions: global (entire instance), project (within specific project), group (within specific group). Searchable: projects, issues, merge_requests, milestones, users, blobs (code), commits, wiki_blobs, notes.

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `global` | Free | Search across entire GitLab instance |
| `project` | Free | Search within a specific project |
| `group` | Free | Search within a specific group and its subgroups |

#### Parameters

**Common** (all actions):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per_page` | integer | Yes | Number of items per page (default: 20, max: 100) |
| `scope` | string | Yes | Search scope determining what type of resources to search |
| `search` | string | Yes | Search query string (minimum 1 character) |
| `confidential` | boolean | No | Filter by confidentiality (for issues scope, Premium only) |
| `order_by` | string | No | Sort results by field |
| `page` | integer | No | Page number |
| `sort` | string | No | Sort direction |
| `state` | string | No | Filter by state (for issues and merge_requests scopes) |

**Action `group`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `group_id` | string | Yes | Group ID or URL-encoded path (e.g., 'my-group' or '123') |

**Action `project`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID or URL-encoded path (e.g., 'group/project' or '123') |
| `ref` | string | No | Branch/tag reference for code search (blobs, commits) |

#### Example

```json
{
  "action": "global",
  "scope": "projects",
  "search": "example_search",
  "per_page": 10
}
```

---

## Session

### manage_context [tier: Free]

View and manage runtime session configuration. Actions: show (current host/preset/scope/mode), list_presets (available tool configurations), list_profiles (OAuth users), switch_preset (change active preset), switch_profile (change OAuth user), set_scope (restrict to namespace), reset (restore initial state).

#### Actions

| Action | Tier | Description |
|--------|------|-------------|
| `show` | Free | Display current context including host, preset, scope, and mode |
| `list_presets` | Free | List all available presets with descriptions |
| `list_profiles` | Free | List available OAuth profiles - only works in OAuth mode |
| `switch_preset` | Free | Switch to a different preset configuration |
| `switch_profile` | Free | Switch to a different OAuth profile - OAuth mode only |
| `set_scope` | Free | Set scope to restrict operations to a namespace |
| `reset` | Free | Reset context to initial state from session start |

#### Parameters

**Action `set_scope`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `includeSubgroups` | boolean | Yes | Include subgroups when scope is a group (default: true) |
| `namespace` | string | Yes | Namespace path (e.g., 'my-group' or 'group/project') - type is auto-detected |

**Action `switch_preset`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `preset` | string | Yes | Name of the preset to activate |

**Action `switch_profile`**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profile` | string | Yes | Name of the profile to activate |

#### Example

```json
{
  "action": "show"
}
```

---

