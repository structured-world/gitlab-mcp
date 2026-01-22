/**
 * MCP client detection module
 * Detects which MCP clients are installed on the system
 */

import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import {
  InstallableClient,
  ClientDetectionResult,
  CLIENT_METADATA,
  INSTALLABLE_CLIENTS,
} from "./types";
import { expandPath } from "../utils/path-utils.js";

// Re-export expandPath for backwards compatibility with existing imports
export { expandPath } from "../utils/path-utils.js";

/**
 * Get config path for a client on current platform
 */
export function getConfigPath(client: InstallableClient): string | undefined {
  const metadata = CLIENT_METADATA[client];
  const platform = process.platform as "darwin" | "win32" | "linux";
  return metadata.configPaths[platform];
}

/**
 * Check if a CLI command exists
 */
export function commandExists(command: string): boolean {
  try {
    const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Validate bundle ID format to prevent command injection
 */
function isValidBundleId(bundleId: string): boolean {
  // Bundle IDs are reverse-domain format: com.example.app
  return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(bundleId);
}

/**
 * Check if macOS app bundle exists
 */
function appBundleExists(bundleId: string): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  // Validate bundleId format to prevent command injection
  if (!isValidBundleId(bundleId)) {
    return false;
  }

  try {
    const result = spawnSync("mdfind", [`kMDItemCFBundleIdentifier == "${bundleId}"`], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return result.status === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if gitlab-mcp is already configured in a JSON config file
 */
export function isAlreadyConfigured(configPath: string): boolean {
  try {
    const expanded = expandPath(configPath);
    if (!existsSync(expanded)) {
      return false;
    }

    const content = readFileSync(expanded, "utf8");
    const config = JSON.parse(content) as Record<string, unknown>;

    // Check for mcpServers.gitlab or mcpServers["gitlab-mcp"]
    const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
    if (mcpServers) {
      return "gitlab" in mcpServers || "gitlab-mcp" in mcpServers;
    }

    // Check for servers.gitlab (different config format)
    const servers = config.servers as Record<string, unknown> | undefined;
    if (servers) {
      return "gitlab" in servers || "gitlab-mcp" in servers;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Detect a single MCP client
 */
export function detectClient(client: InstallableClient): ClientDetectionResult {
  const metadata = CLIENT_METADATA[client];
  const configPath = getConfigPath(client);
  const expandedPath = configPath ? expandPath(configPath) : undefined;

  const result: ClientDetectionResult = {
    client,
    detected: false,
    method: metadata.detectionMethod,
  };

  if (configPath) {
    result.configPath = expandedPath;
  }

  switch (metadata.detectionMethod) {
    case "cli-command":
      if (metadata.cliCommand && commandExists(metadata.cliCommand)) {
        result.detected = true;
      }
      break;

    case "app-bundle":
      if (metadata.appBundleId && appBundleExists(metadata.appBundleId)) {
        result.detected = true;
      }
      // Also check config file as fallback
      if (!result.detected && expandedPath) {
        // Check if config directory exists (even without config file)
        const configDir = expandedPath.replace(/\/[^/]+$/, "");
        if (existsSync(configDir)) {
          result.detected = true;
        }
      }
      break;

    case "config-file":
      // For config-file detection, check if parent directory exists
      // (client may be installed but not configured yet)
      if (expandedPath) {
        const configDir = expandedPath.replace(/\/[^/]+$/, "");
        if (existsSync(configDir)) {
          result.detected = true;
        }
      }
      break;
  }

  // Check if config file exists and if already configured
  if (expandedPath) {
    result.configExists = existsSync(expandedPath);
    if (result.configExists) {
      result.alreadyConfigured = isAlreadyConfigured(expandedPath);
    }
  }

  return result;
}

/**
 * Detect all installed MCP clients
 */
export function detectAllClients(): ClientDetectionResult[] {
  return INSTALLABLE_CLIENTS.map(client => detectClient(client));
}

/**
 * Get list of detected clients (installed on the system)
 */
export function getDetectedClients(): ClientDetectionResult[] {
  return detectAllClients().filter(result => result.detected);
}

/**
 * Get list of clients that are already configured with gitlab-mcp
 */
export function getConfiguredClients(): ClientDetectionResult[] {
  return detectAllClients().filter(result => result.alreadyConfigured);
}
