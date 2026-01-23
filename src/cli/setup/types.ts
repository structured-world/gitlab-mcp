/**
 * Types for the unified setup wizard
 */

import { InstallableClient, ClientDetectionResult } from "../install/types";
import { DockerStatusResult, GitLabInstance } from "../docker/types";

/**
 * Setup mode - what the user wants to do
 */
export type SetupMode = "configure-existing" | "local" | "server";

/**
 * Transport mode for the MCP server
 */
export type TransportMode = "stdio" | "sse";

/**
 * Tool configuration mode
 */
export type ToolConfigMode = "preset" | "manual" | "advanced";

/**
 * Docker deployment type
 */
export type DockerDeploymentType = "standalone" | "external-db" | "compose-bundle";

/**
 * Discovery result from environment detection
 */
export interface DiscoveryResult {
  /** MCP Client detection */
  clients: {
    /** Clients installed on the system */
    detected: ClientDetectionResult[];
    /** Clients already configured with gitlab-mcp */
    configured: ClientDetectionResult[];
    /** Clients detected but not configured */
    unconfigured: ClientDetectionResult[];
  };

  /** Docker environment */
  docker: DockerStatusResult;

  /** Summary for display */
  summary: {
    /** Whether any existing setup was found */
    hasExistingSetup: boolean;
    /** Number of detected clients */
    clientCount: number;
    /** Number of configured clients */
    configuredCount: number;
    /** Whether Docker is running */
    dockerRunning: boolean;
    /** Whether gitlab-mcp container exists */
    containerExists: boolean;
  };
}

/**
 * Tool category for manual selection
 */
export interface ToolCategory {
  /** Category identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what the category provides */
  description: string;
  /** Tool names in this category */
  tools: string[];
  /** Whether enabled by default */
  defaultEnabled: boolean;
}

/**
 * Tool configuration result
 */
export interface ToolConfig {
  /** Configuration mode used */
  mode: ToolConfigMode;
  /** Selected preset name (if mode is 'preset') */
  preset?: string;
  /** Enabled tool categories (if mode is 'manual') */
  enabledCategories?: string[];
  /** Environment variable overrides (if mode is 'advanced') */
  envOverrides?: Record<string, string>;
}

/**
 * Setup wizard result
 */
export interface SetupResult {
  /** Whether setup completed successfully */
  success: boolean;
  /** Setup mode used (undefined if cancelled before selection) */
  mode?: SetupMode;
  /** Clients that were configured */
  configuredClients?: InstallableClient[];
  /** Docker config (if server mode) */
  dockerConfig?: {
    port: number;
    deploymentType: DockerDeploymentType;
    instances: GitLabInstance[];
  };
  /** Error message if failed */
  error?: string;
}

/**
 * Preset definition for tool selection
 */
export interface PresetDefinition {
  /** Preset identifier (matches YAML filename) */
  id: string;
  /** Display name */
  name: string;
  /** Description shown in wizard */
  description: string;
  /** Tool categories enabled by this preset */
  enabledCategories: string[];
}

/**
 * Advanced settings grouped by category
 */
export interface AdvancedSettingsGroup {
  /** Group identifier */
  id: string;
  /** Display name */
  name: string;
  /** Settings in this group */
  settings: AdvancedSetting[];
}

/**
 * Single advanced setting
 */
export interface AdvancedSetting {
  /** Environment variable name */
  envVar: string;
  /** Display label */
  label: string;
  /** Description */
  description: string;
  /** Default value */
  defaultValue: string;
  /** Setting type */
  type: "text" | "boolean" | "select" | "password";
  /** Options for select type */
  options?: { value: string; label: string }[];
  /** Whether this is a sensitive value (password, token) */
  sensitive?: boolean;
}
