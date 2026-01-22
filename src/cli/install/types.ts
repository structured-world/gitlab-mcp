/**
 * Types for MCP client installation module
 */

import { McpClient, McpServerConfig } from "../init/types";

/**
 * Supported MCP clients for installation
 */
export type InstallableClient = Exclude<McpClient, "generic">;

/**
 * Detection result for an MCP client
 */
export interface ClientDetectionResult {
  /** Client type */
  client: InstallableClient;
  /** Whether the client is installed/detected */
  detected: boolean;
  /** Config file path (if applicable) */
  configPath?: string;
  /** Whether config file exists */
  configExists?: boolean;
  /** Whether gitlab-mcp is already configured */
  alreadyConfigured?: boolean;
  /** Detection method used */
  method: "config-file" | "cli-command" | "app-bundle";
}

/**
 * Installation options
 */
export interface InstallOptions {
  /** Target clients to install */
  clients?: InstallableClient[];
  /** Install to all detected clients */
  all?: boolean;
  /** Only show config, don't write */
  showOnly?: boolean;
  /** Force overwrite existing config */
  force?: boolean;
  /** Server configuration to install */
  serverConfig: McpServerConfig;
  /** GitLab instance URL */
  instanceUrl: string;
  /** Whether using read-only mode */
  readOnly?: boolean;
  /** Preset name */
  presetName?: string;
}

/**
 * Installation result for a single client
 */
export interface InstallResult {
  /** Client type */
  client: InstallableClient;
  /** Whether installation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Path to backup file (if created) */
  backupPath?: string;
  /** Path to config file (if written) */
  configPath?: string;
  /** Whether config was already present */
  wasAlreadyConfigured?: boolean;
}

/**
 * Backup options
 */
export interface BackupOptions {
  /** Path to the config file to backup */
  configPath: string;
  /** Custom backup directory (default: same dir as config) */
  backupDir?: string;
}

/**
 * Backup result
 */
export interface BackupResult {
  /** Whether backup was created */
  created: boolean;
  /** Path to backup file */
  backupPath?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Client config paths by platform
 */
export interface ClientConfigPaths {
  darwin?: string;
  win32?: string;
  linux?: string;
}

/**
 * Client configuration metadata
 */
export interface ClientMetadata {
  /** Display name */
  name: string;
  /** Config paths by platform */
  configPaths: ClientConfigPaths;
  /** Whether client supports CLI installation */
  supportsCliInstall: boolean;
  /** CLI command for installation (if supported) */
  cliCommand?: string;
  /** Detection method */
  detectionMethod: "config-file" | "cli-command" | "app-bundle";
  /** App bundle identifier (macOS) */
  appBundleId?: string;
}

/**
 * Client metadata registry
 */
export const CLIENT_METADATA: Record<InstallableClient, ClientMetadata> = {
  "claude-desktop": {
    name: "Claude Desktop",
    configPaths: {
      darwin: "~/Library/Application Support/Claude/claude_desktop_config.json",
      win32: "%APPDATA%/Claude/claude_desktop_config.json",
      linux: "~/.config/claude/claude_desktop_config.json",
    },
    supportsCliInstall: false,
    detectionMethod: "app-bundle",
    appBundleId: "com.anthropic.claudefordesktop",
  },
  "claude-code": {
    name: "Claude Code",
    configPaths: {
      darwin: "~/.claude.json",
      win32: "%USERPROFILE%/.claude.json",
      linux: "~/.claude.json",
    },
    supportsCliInstall: true,
    cliCommand: "claude",
    detectionMethod: "cli-command",
  },
  cursor: {
    name: "Cursor",
    configPaths: {
      darwin: "~/.cursor/mcp.json",
      win32: "%USERPROFILE%/.cursor/mcp.json",
      linux: "~/.cursor/mcp.json",
    },
    supportsCliInstall: false,
    detectionMethod: "config-file",
  },
  "vscode-copilot": {
    name: "VS Code (GitHub Copilot)",
    configPaths: {
      darwin: ".vscode/mcp.json",
      win32: ".vscode/mcp.json",
      linux: ".vscode/mcp.json",
    },
    supportsCliInstall: false,
    detectionMethod: "config-file",
  },
  windsurf: {
    name: "Windsurf",
    configPaths: {
      darwin: "~/.codeium/windsurf/mcp_config.json",
      win32: "%USERPROFILE%/.codeium/windsurf/mcp_config.json",
      linux: "~/.codeium/windsurf/mcp_config.json",
    },
    supportsCliInstall: false,
    detectionMethod: "config-file",
  },
  cline: {
    name: "Cline",
    configPaths: {
      darwin:
        "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
      win32:
        "%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
      linux:
        "~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    },
    supportsCliInstall: false,
    detectionMethod: "config-file",
  },
  "roo-code": {
    name: "Roo Code",
    configPaths: {
      darwin: "~/.roo/mcp.json",
      win32: "%USERPROFILE%/.roo/mcp.json",
      linux: "~/.roo/mcp.json",
    },
    supportsCliInstall: false,
    detectionMethod: "config-file",
  },
};

/**
 * List of all installable clients
 */
export const INSTALLABLE_CLIENTS: InstallableClient[] = [
  "claude-desktop",
  "claude-code",
  "cursor",
  "vscode-copilot",
  "windsurf",
  "cline",
  "roo-code",
];
