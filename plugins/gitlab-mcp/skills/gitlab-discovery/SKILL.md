---
name: gitlab-discovery
description: Find a GitLab project or namespace and establish the exact target for follow-up repository, merge request, work-item or CI work. Use for GitLab project discovery, not local filesystem search or GitHub repositories.
---

# Find the GitLab target

Use tools from the selected GitLab connection. Read `manage_context` with `{"action":"show"}` when the account/namespace is unclear. Existing namespace restrictions remain authoritative; do not switch accounts or broaden scope to get around a missing result.

1. Find a named project with `browse_projects`, for example `{"action":"search","q":"backend","per_page":20,"page":1}`. For projects in a known group use `{"action":"list","group_id":"example-group","per_page":20,"page":1}`. `browse_namespaces` provides namespace discovery when the target is a group.
2. Select the exact returned `path_with_namespace` or project ID. If several results fit and conversation context cannot resolve them, ask for the target; do not guess from the first result.
3. Inspect the selected project with `{"action":"get","project_id":"example-group/backend"}`. Explain the returned identity and accessible repository details, then use that same project for follow-ups.
4. Retrieve additional pages only as needed to satisfy the request. For an empty result, report that nothing matched within this account/scope. On a tool error, diagnose access instead of claiming the project does not exist.

For subsequent MR review, work items or CI investigation, reuse the verified project identity and load the corresponding installed skill using its host-provided path. Do not assume a repository checkout or an absolute skill installation directory. This discovery workflow performs no GitLab mutations.
