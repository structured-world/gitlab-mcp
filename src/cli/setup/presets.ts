/**
 * Preset definitions and tool categories for the setup wizard
 */

import { ToolCategory, PresetDefinition } from "./types";

/**
 * All available tool categories with their tools
 */
export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: "core",
    name: "Core",
    description: "Projects, namespaces, users",
    tools: ["browse_projects", "browse_namespaces", "get_users"],
    defaultEnabled: true,
  },
  {
    id: "merge-requests",
    name: "Merge Requests",
    description: "MR browsing, creation, discussions, approvals",
    tools: [
      "browse_merge_requests",
      "manage_merge_request",
      "browse_mr_discussions",
      "manage_mr_discussion",
      "manage_draft_notes",
    ],
    defaultEnabled: true,
  },
  {
    id: "work-items",
    name: "Work Items",
    description: "Issues, epics, tasks, incidents",
    tools: ["browse_work_items", "manage_work_item"],
    defaultEnabled: true,
  },
  {
    id: "pipelines",
    name: "Pipelines & CI/CD",
    description: "Pipeline browsing, job management, triggers",
    tools: ["browse_pipelines", "manage_pipeline", "manage_pipeline_job"],
    defaultEnabled: true,
  },
  {
    id: "files",
    name: "Files",
    description: "Repository file browsing and management",
    tools: ["browse_files", "manage_files"],
    defaultEnabled: true,
  },
  {
    id: "commits",
    name: "Commits",
    description: "Commit history and diffs",
    tools: ["browse_commits"],
    defaultEnabled: true,
  },
  {
    id: "refs",
    name: "Branches & Tags",
    description: "Branch/tag browsing and protection rules",
    tools: ["browse_refs", "manage_ref"],
    defaultEnabled: false,
  },
  {
    id: "releases",
    name: "Releases",
    description: "Release management and asset links",
    tools: ["browse_releases", "manage_release"],
    defaultEnabled: false,
  },
  {
    id: "labels",
    name: "Labels",
    description: "Label browsing and management",
    tools: ["browse_labels", "manage_label"],
    defaultEnabled: false,
  },
  {
    id: "milestones",
    name: "Milestones",
    description: "Milestone tracking and burndown charts",
    tools: ["browse_milestones", "manage_milestone"],
    defaultEnabled: false,
  },
  {
    id: "wiki",
    name: "Wiki",
    description: "Wiki page browsing and editing",
    tools: ["browse_wiki", "manage_wiki"],
    defaultEnabled: false,
  },
  {
    id: "snippets",
    name: "Snippets",
    description: "Code snippet management",
    tools: ["browse_snippets", "manage_snippet"],
    defaultEnabled: false,
  },
  {
    id: "variables",
    name: "CI/CD Variables",
    description: "Pipeline variable management",
    tools: ["browse_variables", "manage_variable"],
    defaultEnabled: false,
  },
  {
    id: "webhooks",
    name: "Webhooks",
    description: "Webhook configuration and testing",
    tools: ["list_webhooks", "manage_webhook"],
    defaultEnabled: false,
  },
  {
    id: "integrations",
    name: "Integrations",
    description: "Third-party service integrations",
    tools: ["list_integrations", "manage_integration"],
    defaultEnabled: false,
  },
  {
    id: "members",
    name: "Members",
    description: "Team member management and access levels",
    tools: ["browse_members", "manage_member"],
    defaultEnabled: false,
  },
  {
    id: "search",
    name: "Search",
    description: "Global, project, and group search",
    tools: ["browse_search"],
    defaultEnabled: false,
  },
  {
    id: "context",
    name: "Context",
    description: "Runtime session context management",
    tools: ["manage_context"],
    defaultEnabled: false,
  },
];

/**
 * Preset definitions for quick setup
 */
export const PRESET_DEFINITIONS: PresetDefinition[] = [
  {
    id: "developer",
    name: "Developer",
    description: "Standard development workflow (issues, MRs, pipelines)",
    enabledCategories: [
      "core",
      "merge-requests",
      "work-items",
      "pipelines",
      "files",
      "commits",
      "labels",
      "snippets",
      "releases",
      "search",
    ],
  },
  {
    id: "senior-dev",
    name: "Senior Developer",
    description: "Extended access with refs, wiki, and branch management",
    enabledCategories: [
      "core",
      "merge-requests",
      "work-items",
      "pipelines",
      "files",
      "commits",
      "refs",
      "labels",
      "snippets",
      "releases",
      "search",
    ],
  },
  {
    id: "devops",
    name: "DevOps Engineer",
    description: "CI/CD focused (pipelines, variables, webhooks, releases)",
    enabledCategories: [
      "core",
      "pipelines",
      "files",
      "commits",
      "refs",
      "releases",
      "variables",
      "webhooks",
      "integrations",
      "search",
    ],
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Code review workflow (MRs, discussions, approvals)",
    enabledCategories: [
      "core",
      "merge-requests",
      "work-items",
      "pipelines",
      "files",
      "commits",
      "labels",
      "search",
    ],
  },
  {
    id: "full-access",
    name: "Full Access",
    description: "All features enabled (admin/tech-lead)",
    enabledCategories: TOOL_CATEGORIES.map(c => c.id),
  },
  {
    id: "readonly",
    name: "Read-Only",
    description: "Read-only access for monitoring and viewing",
    enabledCategories: [
      "core",
      "merge-requests",
      "work-items",
      "pipelines",
      "files",
      "commits",
      "refs",
      "releases",
      "labels",
      "milestones",
      "members",
      "search",
    ],
  },
];

/**
 * Get preset definition by ID
 */
export function getPresetById(id: string): PresetDefinition | undefined {
  return PRESET_DEFINITIONS.find(p => p.id === id);
}

/**
 * Get tool category by ID
 */
export function getCategoryById(id: string): ToolCategory | undefined {
  return TOOL_CATEGORIES.find(c => c.id === id);
}

/**
 * Get total tool count for a list of category IDs
 */
export function getToolCount(categoryIds: string[]): number {
  return TOOL_CATEGORIES.filter(c => categoryIds.includes(c.id)).reduce(
    (count, c) => count + c.tools.length,
    0
  );
}

/**
 * Get total available tool count
 */
export function getTotalToolCount(): number {
  return TOOL_CATEGORIES.reduce((count, c) => count + c.tools.length, 0);
}
