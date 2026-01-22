/**
 * Types for the init wizard
 */

/**
 * User role selection for preset mapping.
 *
 * IMPORTANT: These are wizard-facing role names that users see and select.
 * They differ from the actual GITLAB_MCP_PRESET values for better UX:
 *   - "reviewer" (wizard) → "code-reviewer" (preset)
 *   - "senior-developer" (wizard) → "senior-dev" (preset)
 *   - "tech-lead" (wizard) → "full-access" (preset)
 *
 * The mapping is defined in ROLE_PRESETS below.
 */
export type UserRole =
  | "developer"
  | "senior-developer"
  | "tech-lead"
  | "devops"
  | "reviewer" // Maps to "code-reviewer" preset
  | "readonly";

/**
 * GitLab instance type
 */
export type InstanceType = "saas" | "self-hosted";

/**
 * MCP client type for configuration generation
 */
export type McpClient =
  | "claude-desktop"
  | "claude-code"
  | "cursor"
  | "vscode-copilot"
  | "windsurf"
  | "cline"
  | "roo-code"
  | "generic";

/**
 * Configuration gathered during wizard
 */
export interface WizardConfig {
  /** GitLab instance URL */
  instanceUrl: string;

  /** Personal Access Token */
  token: string;

  /** User role for preset selection */
  role: UserRole;

  /** Target MCP client */
  client: McpClient;

  /** Whether to use read-only mode */
  readOnly: boolean;

  /** Detected preset name based on role */
  presetName?: string;
}

/**
 * Result of connection test
 */
export interface ConnectionTestResult {
  success: boolean;
  username?: string;
  email?: string;
  isAdmin?: boolean;
  gitlabVersion?: string;
  error?: string;
}

/**
 * Generated configuration for MCP client
 */
export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Role to preset mapping.
 * Maps wizard-facing UserRole values to actual GITLAB_MCP_PRESET names.
 * Some mappings differ (e.g., "reviewer" → "code-reviewer") to provide
 * simpler labels in the wizard UI while using correct preset identifiers.
 */
export const ROLE_PRESETS: Record<UserRole, string> = {
  developer: "developer",
  "senior-developer": "senior-dev",
  "tech-lead": "full-access",
  devops: "devops",
  reviewer: "code-reviewer", // Wizard uses "reviewer", preset is "code-reviewer"
  readonly: "readonly",
};

/**
 * Role descriptions for wizard selection
 */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  developer: "Standard development workflow (issues, MRs, pipelines)",
  "senior-developer": "Extended access with wiki, snippets, variables",
  "tech-lead": "Full access to all features including admin tools",
  devops: "CI/CD focused (pipelines, variables, deployments)",
  reviewer: "Code review workflow (MRs, discussions, approvals)",
  readonly: "Read-only access for monitoring and viewing",
};

/**
 * MCP client display names and config paths
 */
export const MCP_CLIENT_INFO: Record<
  McpClient,
  {
    name: string;
    configPath: string;
    supportsCliInstall: boolean;
  }
> = {
  "claude-desktop": {
    name: "Claude Desktop",
    configPath:
      process.platform === "darwin"
        ? "~/Library/Application Support/Claude/claude_desktop_config.json"
        : process.platform === "win32"
          ? "%APPDATA%/Claude/claude_desktop_config.json"
          : "",
    supportsCliInstall: false,
  },
  "claude-code": {
    name: "Claude Code",
    configPath: "~/.claude.json",
    supportsCliInstall: true,
  },
  cursor: {
    name: "Cursor",
    configPath: "~/.cursor/mcp.json",
    supportsCliInstall: false,
  },
  "vscode-copilot": {
    name: "VS Code (GitHub Copilot)",
    configPath: ".vscode/mcp.json",
    supportsCliInstall: false,
  },
  windsurf: {
    name: "Windsurf",
    configPath: "~/.codeium/windsurf/mcp_config.json",
    supportsCliInstall: false,
  },
  cline: {
    name: "Cline",
    configPath:
      "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    supportsCliInstall: false,
  },
  "roo-code": {
    name: "Roo Code",
    configPath: "~/.roo/mcp.json",
    supportsCliInstall: false,
  },
  generic: {
    name: "Other / Generic",
    configPath: "",
    supportsCliInstall: false,
  },
};
