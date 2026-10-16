/**
 * Listing metadata of the GitLab MCP plugin package.
 *
 * Identity, version, license and links come from package.json at build time;
 * this module holds only what package.json has no field for. Privacy and terms
 * links belong to whoever operates the endpoint and are build inputs.
 */

/** Plugin identifier: hosts use it as the plugin ID and the component namespace. */
export const PLUGIN_NAME = 'gitlab-mcp';

/** Key of the single MCP server in mcp.json. */
export const MCP_SERVER_NAME = 'gitlab';

/** Skill opened when the plugin is first set up. */
export const ONBOARDING_SKILL = 'gitlab-setup';

/** Directory search terms; package.json keywords target npm and name other hosts. */
export const PLUGIN_KEYWORDS = [
  'gitlab',
  'merge-requests',
  'code-review',
  'ci-cd',
  'pipelines',
  'issues',
  'devops',
] as const;

/** Package-relative path of the logo, shared with the MCPB bundle. */
export const LOGO_SOURCE = 'plugin/assets/logo.png';

export const LISTING = {
  displayName: 'GitLab MCP',
  shortDescription: 'GitLab projects, MRs and CI',
  longDescription:
    'Work with GitLab from chat: browse projects and repositories, review and manage merge requests, ' +
    'triage issues, epics and other work items, inspect and run CI/CD pipelines, and manage releases, ' +
    'wiki pages, labels and milestones. Sign in with your GitLab account; every call runs with your ' +
    'own GitLab permissions, and the account settings page limits the tools, projects and groups a ' +
    'chat can use or keeps it read-only. Works with GitLab.com and self-managed GitLab 16.0 or later, ' +
    'as the endpoint operator configures. Features GitLab does not offer on an instance or tier stay ' +
    'unavailable there.',
  developerName: 'Structured World',
  category: 'Developer Tools',
  capabilities: ['Interactive', 'Read', 'Write'],
  defaultPrompt: [
    'Show my open merge requests and which ones wait for my review',
    'Why did the latest pipeline on main fail?',
    'Summarize the issues assigned to me in this milestone',
  ],
  // 6.1:1 against white; the directory requires at least 2:1.
  brandColor: '#6B4FBB',
} as const;
