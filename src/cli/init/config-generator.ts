/**
 * Configuration generator for various MCP clients
 */

import { McpServerConfig, WizardConfig, MCP_CLIENT_INFO, ROLE_PRESETS } from "./types";

/**
 * Generate MCP server configuration object
 */
export function generateServerConfig(config: WizardConfig): McpServerConfig {
  const env: Record<string, string> = {
    GITLAB_API_URL: config.instanceUrl,
    GITLAB_TOKEN: config.token,
  };

  // Add preset if mapped from role
  const presetName = ROLE_PRESETS[config.role];
  if (presetName) {
    env.GITLAB_MCP_PRESET = presetName;
  }

  // Add read-only mode if selected
  if (config.readOnly) {
    env.GITLAB_READ_ONLY_MODE = "true";
  }

  return {
    command: "npx",
    args: ["-y", "@structured-world/gitlab-mcp@latest"],
    env,
  };
}

/**
 * Generate JSON configuration for mcpServers format (most clients)
 */
export function generateMcpServersJson(config: WizardConfig, serverName = "gitlab"): string {
  const serverConfig = generateServerConfig(config);

  const mcpServers = {
    mcpServers: {
      [serverName]: serverConfig,
    },
  };

  return JSON.stringify(mcpServers, null, 2);
}

/**
 * Generate Claude Code CLI command
 */
export function generateClaudeCodeCommand(config: WizardConfig, serverName = "gitlab"): string {
  const serverConfig = generateServerConfig(config);

  // Build environment variable flags
  const envFlags = Object.entries(serverConfig.env)
    .map(([key, value]) => `--env ${key}="${value}"`)
    .join(" ");

  // claude mcp add <name> <command> [args...] --env KEY=VALUE
  return `claude mcp add ${serverName} ${serverConfig.command} ${serverConfig.args.join(" ")} ${envFlags}`;
}

/**
 * Generate configuration based on client type
 */
export function generateClientConfig(config: WizardConfig): {
  type: "json" | "cli" | "instructions";
  content: string;
  configPath?: string;
  cliCommand?: string;
} {
  const clientInfo = MCP_CLIENT_INFO[config.client];

  // Claude Code supports CLI installation
  if (config.client === "claude-code") {
    return {
      type: "cli",
      content: generateMcpServersJson(config),
      cliCommand: generateClaudeCodeCommand(config),
      configPath: clientInfo.configPath,
    };
  }

  // Most clients use mcpServers JSON format
  if (config.client !== "generic") {
    return {
      type: "json",
      content: generateMcpServersJson(config),
      configPath: clientInfo.configPath,
    };
  }

  // Generic: just provide the server config
  return {
    type: "instructions",
    content: generateMcpServersJson(config),
  };
}

/**
 * Generate Claude Deep Link for one-click installation
 * Format: claude://settings/mcp/add?config=BASE64
 */
export function generateClaudeDeepLink(config: WizardConfig, serverName = "gitlab"): string {
  const serverConfig = generateServerConfig(config);

  const configObject = {
    name: serverName,
    ...serverConfig,
  };

  const base64Config = Buffer.from(JSON.stringify(configObject)).toString("base64");
  return `claude://settings/mcp/add?config=${base64Config}`;
}

/**
 * Generate environment variable export commands (for shell)
 */
export function generateEnvExports(config: WizardConfig): string {
  const serverConfig = generateServerConfig(config);

  return Object.entries(serverConfig.env)
    .map(([key, value]) => `export ${key}="${value}"`)
    .join("\n");
}
