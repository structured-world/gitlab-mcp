/**
 * Docker utilities for gitlab-mcp container management
 */

import { spawnSync, spawn, ChildProcess } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import YAML from "yaml";
import {
  DockerConfig,
  DockerComposeFile,
  DockerStatusResult,
  DockerCommandResult,
  ContainerInfo,
  ContainerStatus,
  GitLabInstance,
  InstancesYaml,
  DEFAULT_DOCKER_CONFIG,
  getConfigDir,
} from "./types";
import { expandPath } from "../utils/path-utils.js";

// Re-export expandPath for backwards compatibility with existing imports
export { expandPath } from "../utils/path-utils.js";

/**
 * Get expanded config directory path
 */
export function getExpandedConfigDir(): string {
  return expandPath(getConfigDir());
}

/**
 * Check if Docker is installed
 */
export function isDockerInstalled(): boolean {
  try {
    const result = spawnSync("docker", ["--version"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if Docker daemon is running
 */
export function isDockerRunning(): boolean {
  try {
    const result = spawnSync("docker", ["info"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if Docker Compose is installed
 */
export function isComposeInstalled(): boolean {
  // Try docker compose (v2)
  try {
    const result = spawnSync("docker", ["compose", "version"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (result.status === 0) return true;
  } catch {
    // Continue to try docker-compose
  }

  // Try docker-compose (v1)
  try {
    const result = spawnSync("docker-compose", ["--version"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Validate container name format to prevent command injection
 */
function isValidContainerName(name: string): boolean {
  // Docker container names can only contain [a-zA-Z0-9][a-zA-Z0-9_.-]
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

/**
 * Get container info
 */
export function getContainerInfo(containerName: string = "gitlab-mcp"): ContainerInfo | undefined {
  // Validate container name to prevent command injection
  if (!isValidContainerName(containerName)) {
    console.error(
      `Invalid container name: "${containerName}". Name must match [a-zA-Z0-9][a-zA-Z0-9_.-]*`
    );
    return undefined;
  }

  try {
    const result = spawnSync(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        `name=${containerName}`,
        "--format",
        "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}",
      ],
      {
        stdio: "pipe",
        encoding: "utf8",
      }
    );

    if (result.status !== 0 || !result.stdout.trim()) {
      return undefined;
    }

    const line = result.stdout.trim().split("\n")[0];
    const parts = line.split("|");

    if (parts.length < 6) {
      return undefined;
    }

    const [id, name, image, statusStr, ports, created] = parts;

    // Parse status
    let status: ContainerStatus = "exited";
    const statusLower = statusStr.toLowerCase();
    if (statusLower.includes("up")) {
      status = "running";
    } else if (statusLower.includes("paused")) {
      status = "paused";
    } else if (statusLower.includes("restarting")) {
      status = "restarting";
    } else if (statusLower.includes("created")) {
      status = "created";
    } else if (statusLower.includes("dead")) {
      status = "dead";
    }

    // Extract uptime from status string
    let uptime: string | undefined;
    const uptimeMatch = statusStr.match(/Up\s+(.+?)(?:\s*\(|$)/i);
    if (uptimeMatch) {
      uptime = uptimeMatch[1].trim();
    }

    return {
      id,
      name,
      image,
      status,
      ports: ports ? ports.split(",").map(p => p.trim()) : [],
      created,
      uptime,
    };
  } catch {
    return undefined;
  }
}

/**
 * Get Docker status
 */
export function getDockerStatus(containerName: string = "gitlab-mcp"): DockerStatusResult {
  const result: DockerStatusResult = {
    dockerInstalled: isDockerInstalled(),
    dockerRunning: false,
    composeInstalled: false,
    instances: [],
  };

  if (result.dockerInstalled) {
    result.dockerRunning = isDockerRunning();
    result.composeInstalled = isComposeInstalled();

    if (result.dockerRunning) {
      result.container = getContainerInfo(containerName);
    }
  }

  // Load instances from config
  result.instances = loadInstances();

  return result;
}

/**
 * Generate docker-compose.yml content
 */
export function generateDockerCompose(config: DockerConfig): string {
  const compose: DockerComposeFile = {
    version: "3.8",
    services: {
      "gitlab-mcp": {
        image: config.image,
        container_name: config.containerName,
        ports: [`\${PORT:-${config.port}}:3333`],
        environment: ["TRANSPORT=sse", "PORT=3333", `OAUTH_ENABLED=${config.oauthEnabled}`],
        volumes: ["gitlab-mcp-data:/data"],
        restart: "unless-stopped",
      },
    },
    volumes: {
      "gitlab-mcp-data": {},
    },
  };

  // Add OAuth-specific configuration
  if (config.oauthEnabled) {
    compose.services["gitlab-mcp"].environment.push(
      "OAUTH_SESSION_SECRET=${OAUTH_SESSION_SECRET}",
      "DATABASE_URL=file:/data/sessions.db"
    );
    compose.services["gitlab-mcp"].volumes.push("./instances.yml:/app/config/instances.yml:ro");
  }

  // Add tool configuration environment variables
  if (config.environment) {
    for (const [key, value] of Object.entries(config.environment)) {
      compose.services["gitlab-mcp"].environment.push(`${key}=${value}`);
    }
  }

  return YAML.stringify(compose);
}

/**
 * Generate instances.yml content
 */
export function generateInstancesYaml(instances: GitLabInstance[]): string {
  const yaml: InstancesYaml = {
    instances: {},
  };

  for (const instance of instances) {
    yaml.instances[instance.host] = {
      name: instance.name,
    };

    if (instance.oauth) {
      yaml.instances[instance.host].oauth = {
        client_id: instance.oauth.clientId,
        client_secret_env: instance.oauth.clientSecretEnv,
      };
    }

    if (instance.defaultPreset) {
      yaml.instances[instance.host].default_preset = instance.defaultPreset;
    }
  }

  return YAML.stringify(yaml);
}

/**
 * Load instances from config file
 */
export function loadInstances(): GitLabInstance[] {
  const configDir = getExpandedConfigDir();
  const instancesPath = join(configDir, "instances.yml");

  if (!existsSync(instancesPath)) {
    return [];
  }

  try {
    const content = readFileSync(instancesPath, "utf8");
    const yaml = YAML.parse(content) as InstancesYaml;

    return Object.entries(yaml.instances).map(([host, config]) => ({
      host,
      name: config.name,
      oauth: config.oauth
        ? {
            clientId: config.oauth.client_id,
            clientSecretEnv: config.oauth.client_secret_env,
          }
        : undefined,
      defaultPreset: config.default_preset,
    }));
  } catch {
    return [];
  }
}

/**
 * Save instances to config file
 */
export function saveInstances(instances: GitLabInstance[]): void {
  const configDir = getExpandedConfigDir();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const instancesPath = join(configDir, "instances.yml");
  const content = generateInstancesYaml(instances);
  writeFileSync(instancesPath, content, "utf8");
}

/**
 * Save docker-compose.yml to config directory
 */
export function saveDockerCompose(config: DockerConfig): void {
  const configDir = getExpandedConfigDir();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const composePath = join(configDir, "docker-compose.yml");
  const content = generateDockerCompose(config);
  writeFileSync(composePath, content, "utf8");
}

/**
 * Run docker compose command
 */
export function runComposeCommand(args: string[], configDir?: string): DockerCommandResult {
  const cwd = configDir ?? getExpandedConfigDir();

  // Check if docker-compose.yml exists
  const composePath = join(cwd, "docker-compose.yml");
  if (!existsSync(composePath)) {
    return {
      success: false,
      error: `docker-compose.yml not found in ${cwd}. Run 'gitlab-mcp docker init' first.`,
    };
  }

  try {
    // Try docker compose v2 first
    let result = spawnSync("docker", ["compose", ...args], {
      cwd,
      stdio: "pipe",
      encoding: "utf8",
    });

    // Fall back to docker-compose v1 if v2 fails
    if (result.status !== 0 && result.stderr?.includes("is not a docker command")) {
      result = spawnSync("docker-compose", args, {
        cwd,
        stdio: "pipe",
        encoding: "utf8",
      });
    }

    if (result.status === 0) {
      return {
        success: true,
        output: result.stdout,
      };
    } else {
      return {
        success: false,
        error: result.stderr || result.stdout || "Unknown error",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Start container
 */
export function startContainer(): DockerCommandResult {
  return runComposeCommand(["up", "-d"]);
}

/**
 * Stop container
 */
export function stopContainer(): DockerCommandResult {
  return runComposeCommand(["down"]);
}

/**
 * Restart container
 */
export function restartContainer(): DockerCommandResult {
  return runComposeCommand(["restart"]);
}

/**
 * Pull latest image and restart
 */
export function upgradeContainer(): DockerCommandResult {
  const pullResult = runComposeCommand(["pull"]);
  if (!pullResult.success) {
    return pullResult;
  }

  return runComposeCommand(["up", "-d"]);
}

/**
 * Get container logs (returns process for streaming)
 */
export function tailLogs(follow: boolean = true, lines: number = 100): ChildProcess {
  const configDir = getExpandedConfigDir();
  const args = ["compose", "logs"];

  if (follow) {
    args.push("-f");
  }

  args.push("--tail", String(lines));

  return spawn("docker", args, {
    cwd: configDir,
    stdio: "inherit",
  });
}

/**
 * Get container logs (non-streaming)
 */
export function getLogs(lines: number = 100): DockerCommandResult {
  return runComposeCommand(["logs", "--tail", String(lines)]);
}

/**
 * Add a GitLab instance to configuration
 */
export function addInstance(instance: GitLabInstance): void {
  const instances = loadInstances();

  // Check if already exists
  const existingIndex = instances.findIndex(i => i.host === instance.host);
  if (existingIndex >= 0) {
    instances[existingIndex] = instance;
  } else {
    instances.push(instance);
  }

  saveInstances(instances);
}

/**
 * Remove a GitLab instance from configuration
 */
export function removeInstance(host: string): boolean {
  const instances = loadInstances();
  const filteredInstances = instances.filter(i => i.host !== host);

  if (filteredInstances.length === instances.length) {
    return false; // Instance not found
  }

  saveInstances(filteredInstances);
  return true;
}

/**
 * Initialize Docker configuration
 */
export function initDockerConfig(config: Partial<DockerConfig> = {}): DockerConfig {
  const fullConfig: DockerConfig = {
    ...DEFAULT_DOCKER_CONFIG,
    ...config,
  };

  // Save docker-compose.yml
  saveDockerCompose(fullConfig);

  // Save instances if provided
  if (fullConfig.instances.length > 0) {
    saveInstances(fullConfig.instances);
  }

  return fullConfig;
}
