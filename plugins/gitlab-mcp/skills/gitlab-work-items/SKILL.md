---
name: gitlab-work-items
description: Find, inspect, create or update GitLab issues and other work items, including explicitly requested planning follow-ups. Use for GitLab work items, not GitHub issues, and do not infer permission to publish from a request to brainstorm.
---

# Work with GitLab work items

Use the selected connection and verified namespace. The server handles GraphQL work-item type discovery; do not hardcode GitLab type IDs or call a separate REST issues endpoint. Inspect the advertised schema because type availability depends on the instance.

1. Find existing items before creating one: `browse_work_items`, `{"action":"list","namespace":"example-group/backend","types":["ISSUE"],"state":["OPEN"],"first":20}`. Use returned pagination cursors for relevant additional pages.
2. Read details with `{"action":"get","id":"returned-work-item-id"}`. Reuse returned IDs for updates and follow-ups, including IDs of labels, milestones and assignees; do not invent them.
3. Use a project namespace for issues/tasks and a group namespace for epics. Existing scope and permissions apply at both levels. Report unavailable types/actions instead of substituting a different item type.
4. When the user asks to publish a concrete task, create it with `manage_work_item`, for example `{"action":"create","namespace":"example-group/backend","workItemType":"ISSUE","title":"Add connection diagnostics","description":"Problem, implementation and acceptance criteria"}`. Write a single actionable plan with the requested scope, useful validation and dependencies. Exclude secrets, private planning identifiers and unsupported estimates.
5. For a requested update, inspect the current item and apply the specific fields using `update` and the returned ID. Verify the persisted result with `get` and report its link. Delete/close/link only when requested.

An empty successful listing is distinct from an authorization error. A submitted mutation with a timeout has an unknown outcome: reconcile using the returned ID or a narrow listing before retrying. Do not bypass read-only policy, switch accounts or request credentials to complete an unauthorized write.
