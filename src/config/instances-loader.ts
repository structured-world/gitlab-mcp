/**
 * Instance Configuration Loader
 *
 * Loads GitLab instance configuration from multiple sources:
 * 1. GITLAB_INSTANCES_FILE - Path to YAML/JSON config file
 * 2. GITLAB_INSTANCES - Environment variable (single URL, array, or JSON)
 * 3. GITLAB_API_URL + GITLAB_TOKEN - Legacy single-instance mode
 *
 * Configuration priority (first match wins):
 * 1. GITLAB_INSTANCES_FILE (if set, load from file)
 * 2. GITLAB_INSTANCES (env var - URL, array, or JSON)
 * 3. GITLAB_API_URL (legacy single-instance)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logInfo, logWarn, logError, logDebug } from "../logger.js";
import {
  GitLabInstanceConfig,
  InstancesConfigFile,
  validateInstancesConfig,
  parseInstanceUrlString,
  applyInstanceDefaults,
} from "./instances-schema.js";

/**
 * Loaded instances configuration result
 */
export interface LoadedInstancesConfig {
  /** List of configured instances */
  instances: GitLabInstanceConfig[];
  /** Configuration source for logging */
  source: "file" | "env" | "legacy" | "none";
  /** Source details (file path or env var name) */
  sourceDetails: string;
}

/**
 * Load YAML configuration (requires optional yaml package)
 */
async function loadYamlFile(filePath: string): Promise<unknown> {
  try {
    // Dynamic import to avoid requiring yaml as mandatory dependency
    const yaml = await import("yaml");
    const content = fs.readFileSync(filePath, "utf-8");
    return yaml.parse(content);
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { code?: string; message?: string };
    const code = err.code;
    const message = err.message;

    // Check for missing yaml module - Node ESM uses ERR_MODULE_NOT_FOUND
    const isModuleNotFoundCode = code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
    const isYamlNotFoundMessage =
      typeof message === "string" &&
      (message.includes("Cannot find package 'yaml'") ||
        message.includes("Cannot find module 'yaml'"));

    if (isModuleNotFoundCode || isYamlNotFoundMessage) {
      throw new Error(`YAML configuration requires 'yaml' package. Install with: yarn add yaml`);
    }
    throw error;
  }
}

/**
 * Load JSON configuration
 */
function loadJsonFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}

/**
 * Load configuration from file (YAML or JSON)
 */
async function loadConfigFile(filePath: string): Promise<InstancesConfigFile> {
  // Resolve home directory expansion using os.homedir() for cross-platform support
  const resolvedPath = filePath.startsWith("~")
    ? path.join(os.homedir(), filePath.slice(1))
    : filePath;

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();

  let rawConfig: unknown;

  if (ext === ".yaml" || ext === ".yml") {
    rawConfig = await loadYamlFile(resolvedPath);
  } else if (ext === ".json") {
    rawConfig = loadJsonFile(resolvedPath);
  } else {
    // Try to detect format from content
    const content = fs.readFileSync(resolvedPath, "utf-8").trim();
    if (content.startsWith("{")) {
      rawConfig = JSON.parse(content);
    } else {
      rawConfig = await loadYamlFile(resolvedPath);
    }
  }

  return validateInstancesConfig(rawConfig);
}

/**
 * Parse GITLAB_INSTANCES environment variable
 * Supports formats:
 * - Single URL: "https://gitlab.com"
 * - Bash array: "(https://gitlab.com https://git.corp.io)"
 * - JSON array: '["https://gitlab.com", "https://git.corp.io"]'
 * - JSON object: '{"instances": [...]}'
 */
function parseInstancesEnvVar(value: string): GitLabInstanceConfig[] {
  const trimmed = value.trim();

  // Check for JSON object format
  if (trimmed.startsWith("{")) {
    const parsed: unknown = JSON.parse(trimmed);
    const config = validateInstancesConfig(parsed);
    return config.instances;
  }

  // Check for JSON array format
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as string[];
    return parsed.map((url: string) => parseInstanceUrlString(url));
  }

  // Check for bash array format: (url1 url2 url3)
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(1, -1).trim();
    // Split by whitespace, handling quoted strings
    const urls: string[] = inner.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    return urls.map((url: string) => {
      // Remove surrounding quotes if present
      const cleanUrl = url.startsWith('"') && url.endsWith('"') ? url.slice(1, -1) : url;
      return parseInstanceUrlString(cleanUrl);
    });
  }

  // Check for space-separated URLs (multiple URLs without bash array syntax)
  if (trimmed.includes(" ")) {
    const urls = trimmed.split(/\s+/).filter(url => url.length > 0);
    return urls.map((url: string) => parseInstanceUrlString(url));
  }

  // Single URL format
  return [parseInstanceUrlString(trimmed)];
}

/**
 * Load instances configuration from all sources
 */
export async function loadInstancesConfig(): Promise<LoadedInstancesConfig> {
  const instancesFile = process.env.GITLAB_INSTANCES_FILE;
  const instancesEnv = process.env.GITLAB_INSTANCES;
  const legacyBaseUrl = process.env.GITLAB_API_URL;

  // Priority 1: Configuration file
  if (instancesFile) {
    try {
      logDebug("Loading instances from configuration file", { path: instancesFile });
      const config = await loadConfigFile(instancesFile);

      // Apply defaults to all instances
      const instances = config.instances.map(inst => applyInstanceDefaults(inst, config.defaults));

      logInfo("Loaded GitLab instances from configuration file", {
        path: instancesFile,
        count: instances.length,
        instances: instances.map(i => i.label ?? i.url),
      });

      return {
        instances,
        source: "file",
        sourceDetails: instancesFile,
      };
    } catch (error) {
      logError("Failed to load instances configuration file", {
        path: instancesFile,
        err: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  // Priority 2: Environment variable
  if (instancesEnv) {
    try {
      logDebug("Loading instances from GITLAB_INSTANCES env var");
      const instances = parseInstancesEnvVar(instancesEnv);

      logInfo("Loaded GitLab instances from environment variable", {
        count: instances.length,
        instances: instances.map(i => i.label ?? i.url),
      });

      return {
        instances,
        source: "env",
        sourceDetails: "GITLAB_INSTANCES",
      };
    } catch (error) {
      logError("Failed to parse GITLAB_INSTANCES environment variable", {
        err: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  // Priority 3: Legacy single-instance mode
  if (legacyBaseUrl) {
    logDebug("Using legacy GITLAB_API_URL configuration");

    // Normalize URL (same logic as config.ts normalizeGitLabBaseUrl)
    let normalizedUrl = legacyBaseUrl;
    if (normalizedUrl.endsWith("/")) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }
    if (normalizedUrl.endsWith("/api/v4")) {
      normalizedUrl = normalizedUrl.slice(0, -7);
    }

    const instance: GitLabInstanceConfig = {
      url: normalizedUrl,
      label: "Default Instance",
      insecureSkipVerify: process.env.SKIP_TLS_VERIFY === "true",
    };

    logInfo("Using legacy single-instance configuration", {
      url: normalizedUrl,
    });

    return {
      instances: [instance],
      source: "legacy",
      sourceDetails: "GITLAB_API_URL",
    };
  }

  // No configuration - use default gitlab.com
  logWarn("No GitLab instance configuration found, using gitlab.com as default");

  return {
    instances: [
      {
        url: "https://gitlab.com",
        label: "GitLab.com",
        insecureSkipVerify: false,
      },
    ],
    source: "none",
    sourceDetails: "default",
  };
}

/**
 * Get a specific instance configuration by URL
 */
export function getInstanceByUrl(
  instances: GitLabInstanceConfig[],
  url: string
): GitLabInstanceConfig | undefined {
  // Normalize the search URL
  let normalizedSearch = url;
  if (normalizedSearch.endsWith("/")) {
    normalizedSearch = normalizedSearch.slice(0, -1);
  }
  if (normalizedSearch.endsWith("/api/v4")) {
    normalizedSearch = normalizedSearch.slice(0, -7);
  }

  return instances.find(inst => inst.url === normalizedSearch);
}

/**
 * Check if a URL matches a configured instance
 */
export function isKnownInstance(instances: GitLabInstanceConfig[], url: string): boolean {
  return getInstanceByUrl(instances, url) !== undefined;
}

/**
 * Create a sample configuration file content
 */
export function generateSampleConfig(format: "yaml" | "json"): string {
  const config: InstancesConfigFile = {
    instances: [
      {
        url: "https://gitlab.com",
        label: "GitLab.com",
        insecureSkipVerify: false,
      },
      {
        url: "https://git.corp.io",
        label: "Corporate GitLab",
        oauth: {
          clientId: "your_app_id",
          clientSecret: "your_secret",
          scopes: "api read_user",
        },
        rateLimit: {
          maxConcurrent: 50,
          queueSize: 200,
          queueTimeout: 30000,
        },
        insecureSkipVerify: false,
      },
    ],
    defaults: {
      rateLimit: {
        maxConcurrent: 100,
        queueSize: 500,
        queueTimeout: 60000,
      },
      oauth: {
        scopes: "api read_user",
      },
    },
  };

  if (format === "json") {
    return JSON.stringify(config, null, 2);
  }

  // YAML format - manual generation to preserve comments
  return `# GitLab MCP Instances Configuration
# Documentation: https://gitlab-mcp.sw.foundation/advanced/multi-instance

instances:
  # Minimal configuration (OAuth disabled or uses global credentials)
  - url: https://gitlab.com
    label: "GitLab.com"

  # Full configuration with OAuth
  - url: https://git.corp.io
    label: "Corporate GitLab"
    oauth:
      clientId: "your_app_id"
      clientSecret: "your_secret"  # Only for confidential apps
      scopes: "api read_user"      # Optional, default: api read_user
    rateLimit:
      maxConcurrent: 50            # Max parallel requests
      queueSize: 200               # Max queued requests
      queueTimeout: 30000          # Queue wait timeout (ms)

# Global defaults (applied to all instances unless overridden)
defaults:
  rateLimit:
    maxConcurrent: 100
    queueSize: 500
    queueTimeout: 60000
  oauth:
    scopes: "api read_user"
`;
}
