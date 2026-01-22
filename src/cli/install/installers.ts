/**
 * MCP client installers
 * Implements installation logic for each supported MCP client
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { spawnSync } from "child_process";
import { InstallableClient, InstallResult, CLIENT_METADATA } from "./types";
import { McpServerConfig } from "../init/types";
import { expandPath, getConfigPath } from "./detector";
import { createBackup } from "./backup";

/**
 * Server entry for JSON config files
 */
interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * JSON config structure for MCP clients
 */
interface McpJsonConfig {
  mcpServers?: Record<string, McpServerEntry>;
  servers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

/**
 * Build server entry from config
 */
function buildServerEntry(serverConfig: McpServerConfig): McpServerEntry {
  const entry: McpServerEntry = {
    command: serverConfig.command,
    args: serverConfig.args,
  };

  if (Object.keys(serverConfig.env).length > 0) {
    entry.env = serverConfig.env;
  }

  return entry;
}

/**
 * Read existing JSON config or return empty object
 */
function readJsonConfig(configPath: string): McpJsonConfig {
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf8");
      return JSON.parse(content) as McpJsonConfig;
    }
  } catch {
    // Return empty config on parse error
  }
  return {};
}

/**
 * Write JSON config with proper formatting
 */
function writeJsonConfig(configPath: string, config: McpJsonConfig): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/**
 * Install to Claude Desktop (JSON config)
 */
export function installClaudeDesktop(
  serverConfig: McpServerConfig,
  force: boolean = false
): InstallResult {
  const client: InstallableClient = "claude-desktop";
  const configPath = getConfigPath(client);

  if (!configPath) {
    return {
      client,
      success: false,
      error: "Claude Desktop config path not available for this platform",
    };
  }

  const expandedPath = expandPath(configPath);

  try {
    // Create backup if config exists
    let backupPath: string | undefined;
    if (existsSync(expandedPath)) {
      const backupResult = createBackup({ configPath: expandedPath });
      if (backupResult.created) {
        backupPath = backupResult.backupPath;
      }
    }

    // Read existing config
    const config = readJsonConfig(expandedPath);
    const wasAlreadyConfigured =
      config.mcpServers?.gitlab !== undefined || config.mcpServers?.["gitlab-mcp"] !== undefined;

    if (wasAlreadyConfigured && !force) {
      return {
        client,
        success: false,
        error: "gitlab-mcp is already configured. Use --force to overwrite.",
        wasAlreadyConfigured: true,
        configPath: expandedPath,
      };
    }

    // Add/update gitlab server
    config.mcpServers ??= {};
    config.mcpServers.gitlab = buildServerEntry(serverConfig);

    // Remove old name if exists
    delete config.mcpServers["gitlab-mcp"];

    // Write config
    writeJsonConfig(expandedPath, config);

    return {
      client,
      success: true,
      backupPath,
      configPath: expandedPath,
      wasAlreadyConfigured,
    };
  } catch (error) {
    return {
      client,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install to Claude Code (via claude mcp add command)
 */
export function installClaudeCode(
  serverConfig: McpServerConfig,
  force: boolean = false
): InstallResult {
  const client: InstallableClient = "claude-code";
  const metadata = CLIENT_METADATA[client];

  if (!metadata.cliCommand) {
    return {
      client,
      success: false,
      error: "Claude Code CLI command not configured",
    };
  }

  try {
    // Build command arguments
    const args = ["mcp", "add", "gitlab", serverConfig.command, ...serverConfig.args];

    // Add environment variables
    for (const [key, value] of Object.entries(serverConfig.env)) {
      args.push("--env", `${key}=${value}`);
    }

    // Add force flag if needed
    if (force) {
      // Check if gitlab is already configured by running claude mcp list
      const listResult = spawnSync(metadata.cliCommand, ["mcp", "list"], {
        stdio: "pipe",
        encoding: "utf8",
      });

      if (listResult.status === 0 && listResult.stdout.includes("gitlab")) {
        // Remove existing config first
        spawnSync(metadata.cliCommand, ["mcp", "remove", "gitlab"], {
          stdio: "pipe",
          encoding: "utf8",
        });
      }
    }

    // Run claude mcp add
    const result = spawnSync(metadata.cliCommand, args, {
      stdio: "pipe",
      encoding: "utf8",
    });

    if (result.status === 0) {
      return {
        client,
        success: true,
      };
    } else {
      const errorOutput = result.stderr || result.stdout || "Unknown error";
      // Check if already configured
      if (errorOutput.includes("already exists") || errorOutput.includes("already configured")) {
        return {
          client,
          success: false,
          error: "gitlab-mcp is already configured. Use --force to overwrite.",
          wasAlreadyConfigured: true,
        };
      }
      return {
        client,
        success: false,
        error: errorOutput,
      };
    }
  } catch (error) {
    return {
      client,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install to Cursor (JSON config)
 */
export function installCursor(
  serverConfig: McpServerConfig,
  force: boolean = false
): InstallResult {
  const client: InstallableClient = "cursor";
  const configPath = getConfigPath(client);

  if (!configPath) {
    return {
      client,
      success: false,
      error: "Cursor config path not available for this platform",
    };
  }

  const expandedPath = expandPath(configPath);

  try {
    // Create backup if config exists
    let backupPath: string | undefined;
    if (existsSync(expandedPath)) {
      const backupResult = createBackup({ configPath: expandedPath });
      if (backupResult.created) {
        backupPath = backupResult.backupPath;
      }
    }

    // Read existing config
    const config = readJsonConfig(expandedPath);
    const wasAlreadyConfigured =
      config.mcpServers?.gitlab !== undefined || config.mcpServers?.["gitlab-mcp"] !== undefined;

    if (wasAlreadyConfigured && !force) {
      return {
        client,
        success: false,
        error: "gitlab-mcp is already configured. Use --force to overwrite.",
        wasAlreadyConfigured: true,
        configPath: expandedPath,
      };
    }

    // Add/update gitlab server
    config.mcpServers ??= {};
    config.mcpServers.gitlab = buildServerEntry(serverConfig);

    // Remove old name if exists
    delete config.mcpServers["gitlab-mcp"];

    // Write config
    writeJsonConfig(expandedPath, config);

    return {
      client,
      success: true,
      backupPath,
      configPath: expandedPath,
      wasAlreadyConfigured,
    };
  } catch (error) {
    return {
      client,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install to VS Code Copilot (JSON config in .vscode/)
 */
export function installVSCodeCopilot(
  serverConfig: McpServerConfig,
  force: boolean = false
): InstallResult {
  const client: InstallableClient = "vscode-copilot";
  const configPath = getConfigPath(client);

  if (!configPath) {
    return {
      client,
      success: false,
      error: "VS Code config path not available",
    };
  }

  // VS Code config is relative to current directory
  const expandedPath = configPath;

  try {
    // Create backup if config exists
    let backupPath: string | undefined;
    if (existsSync(expandedPath)) {
      const backupResult = createBackup({ configPath: expandedPath });
      if (backupResult.created) {
        backupPath = backupResult.backupPath;
      }
    }

    // Read existing config
    const config = readJsonConfig(expandedPath);
    const wasAlreadyConfigured =
      config.servers?.gitlab !== undefined || config.servers?.["gitlab-mcp"] !== undefined;

    if (wasAlreadyConfigured && !force) {
      return {
        client,
        success: false,
        error: "gitlab-mcp is already configured. Use --force to overwrite.",
        wasAlreadyConfigured: true,
        configPath: expandedPath,
      };
    }

    // VS Code uses "servers" instead of "mcpServers"
    config.servers ??= {};
    config.servers.gitlab = buildServerEntry(serverConfig);

    // Remove old name if exists
    delete config.servers["gitlab-mcp"];

    // Write config
    writeJsonConfig(expandedPath, config);

    return {
      client,
      success: true,
      backupPath,
      configPath: expandedPath,
      wasAlreadyConfigured,
    };
  } catch (error) {
    return {
      client,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install to Windsurf (JSON config)
 */
export function installWindsurf(
  serverConfig: McpServerConfig,
  force: boolean = false
): InstallResult {
  const client: InstallableClient = "windsurf";
  const configPath = getConfigPath(client);

  if (!configPath) {
    return {
      client,
      success: false,
      error: "Windsurf config path not available for this platform",
    };
  }

  const expandedPath = expandPath(configPath);

  try {
    // Create backup if config exists
    let backupPath: string | undefined;
    if (existsSync(expandedPath)) {
      const backupResult = createBackup({ configPath: expandedPath });
      if (backupResult.created) {
        backupPath = backupResult.backupPath;
      }
    }

    // Read existing config
    const config = readJsonConfig(expandedPath);
    const wasAlreadyConfigured =
      config.mcpServers?.gitlab !== undefined || config.mcpServers?.["gitlab-mcp"] !== undefined;

    if (wasAlreadyConfigured && !force) {
      return {
        client,
        success: false,
        error: "gitlab-mcp is already configured. Use --force to overwrite.",
        wasAlreadyConfigured: true,
        configPath: expandedPath,
      };
    }

    // Add/update gitlab server
    config.mcpServers ??= {};
    config.mcpServers.gitlab = buildServerEntry(serverConfig);

    // Remove old name if exists
    delete config.mcpServers["gitlab-mcp"];

    // Write config
    writeJsonConfig(expandedPath, config);

    return {
      client,
      success: true,
      backupPath,
      configPath: expandedPath,
      wasAlreadyConfigured,
    };
  } catch (error) {
    return {
      client,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install to Cline (JSON config)
 */
export function installCline(serverConfig: McpServerConfig, force: boolean = false): InstallResult {
  const client: InstallableClient = "cline";
  const configPath = getConfigPath(client);

  if (!configPath) {
    return {
      client,
      success: false,
      error: "Cline config path not available for this platform",
    };
  }

  const expandedPath = expandPath(configPath);

  try {
    // Create backup if config exists
    let backupPath: string | undefined;
    if (existsSync(expandedPath)) {
      const backupResult = createBackup({ configPath: expandedPath });
      if (backupResult.created) {
        backupPath = backupResult.backupPath;
      }
    }

    // Read existing config
    const config = readJsonConfig(expandedPath);
    const wasAlreadyConfigured =
      config.mcpServers?.gitlab !== undefined || config.mcpServers?.["gitlab-mcp"] !== undefined;

    if (wasAlreadyConfigured && !force) {
      return {
        client,
        success: false,
        error: "gitlab-mcp is already configured. Use --force to overwrite.",
        wasAlreadyConfigured: true,
        configPath: expandedPath,
      };
    }

    // Add/update gitlab server
    config.mcpServers ??= {};
    config.mcpServers.gitlab = buildServerEntry(serverConfig);

    // Remove old name if exists
    delete config.mcpServers["gitlab-mcp"];

    // Write config
    writeJsonConfig(expandedPath, config);

    return {
      client,
      success: true,
      backupPath,
      configPath: expandedPath,
      wasAlreadyConfigured,
    };
  } catch (error) {
    return {
      client,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install to Roo Code (JSON config)
 */
export function installRooCode(
  serverConfig: McpServerConfig,
  force: boolean = false
): InstallResult {
  const client: InstallableClient = "roo-code";
  const configPath = getConfigPath(client);

  if (!configPath) {
    return {
      client,
      success: false,
      error: "Roo Code config path not available for this platform",
    };
  }

  const expandedPath = expandPath(configPath);

  try {
    // Create backup if config exists
    let backupPath: string | undefined;
    if (existsSync(expandedPath)) {
      const backupResult = createBackup({ configPath: expandedPath });
      if (backupResult.created) {
        backupPath = backupResult.backupPath;
      }
    }

    // Read existing config
    const config = readJsonConfig(expandedPath);
    const wasAlreadyConfigured =
      config.mcpServers?.gitlab !== undefined || config.mcpServers?.["gitlab-mcp"] !== undefined;

    if (wasAlreadyConfigured && !force) {
      return {
        client,
        success: false,
        error: "gitlab-mcp is already configured. Use --force to overwrite.",
        wasAlreadyConfigured: true,
        configPath: expandedPath,
      };
    }

    // Add/update gitlab server
    config.mcpServers ??= {};
    config.mcpServers.gitlab = buildServerEntry(serverConfig);

    // Remove old name if exists
    delete config.mcpServers["gitlab-mcp"];

    // Write config
    writeJsonConfig(expandedPath, config);

    return {
      client,
      success: true,
      backupPath,
      configPath: expandedPath,
      wasAlreadyConfigured,
    };
  } catch (error) {
    return {
      client,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Client installer registry
 */
const INSTALLERS: Record<
  InstallableClient,
  (serverConfig: McpServerConfig, force: boolean) => InstallResult
> = {
  "claude-desktop": installClaudeDesktop,
  "claude-code": installClaudeCode,
  cursor: installCursor,
  "vscode-copilot": installVSCodeCopilot,
  windsurf: installWindsurf,
  cline: installCline,
  "roo-code": installRooCode,
};

/**
 * Install to a specific client
 */
export function installToClient(
  client: InstallableClient,
  serverConfig: McpServerConfig,
  force: boolean = false
): InstallResult {
  const installer = INSTALLERS[client];
  return installer(serverConfig, force);
}

/**
 * Install to multiple clients
 */
export function installToClients(
  clients: InstallableClient[],
  serverConfig: McpServerConfig,
  force: boolean = false
): InstallResult[] {
  return clients.map(client => installToClient(client, serverConfig, force));
}

/**
 * Generate config JSON for preview (--show mode)
 */
export function generateConfigPreview(
  client: InstallableClient,
  serverConfig: McpServerConfig
): string {
  const entry = buildServerEntry(serverConfig);

  // VS Code uses different key
  if (client === "vscode-copilot") {
    return JSON.stringify({ servers: { gitlab: entry } }, null, 2);
  }

  return JSON.stringify({ mcpServers: { gitlab: entry } }, null, 2);
}
