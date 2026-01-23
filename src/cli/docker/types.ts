/**
 * Types for Docker module
 */

/**
 * Container runtime type (docker or podman)
 */
export type ContainerRuntime = "docker" | "podman";

/**
 * Detected container runtime information
 */
export interface ContainerRuntimeInfo {
  /** Which runtime was detected */
  runtime: ContainerRuntime;
  /** Command to invoke the runtime (e.g. "docker" or "podman") */
  runtimeCmd: string;
  /** Whether the runtime daemon is accessible */
  runtimeAvailable: boolean;
  /** Compose command tokens, e.g. ["docker", "compose"] or ["podman-compose"], null if unavailable */
  composeCmd: string[] | null;
  /** Version string of the runtime, undefined if not detected */
  runtimeVersion?: string;
}

/**
 * Docker container status
 */
export type ContainerStatus =
  | "running"
  | "stopped"
  | "paused"
  | "restarting"
  | "created"
  | "exited"
  | "dead";

/**
 * Docker container info
 */
export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  ports: string[];
  created: string;
  uptime?: string;
}

/**
 * GitLab instance OAuth configuration
 */
export interface GitLabInstanceOAuth {
  clientId: string;
  clientSecretEnv: string;
}

/**
 * GitLab instance configuration
 */
export interface GitLabInstance {
  /** Instance host (e.g., gitlab.com, gitlab.company.com) */
  host: string;
  /** Display name */
  name: string;
  /** OAuth configuration */
  oauth?: GitLabInstanceOAuth;
  /** Default preset for this instance */
  defaultPreset?: string;
}

/**
 * Docker configuration for gitlab-mcp
 */
export interface DockerConfig {
  /** SSE port (default: 3333) */
  port: number;
  /** Enable OAuth mode */
  oauthEnabled: boolean;
  /** OAuth session secret */
  oauthSessionSecret?: string;
  /** Database URL for sessions */
  databaseUrl?: string;
  /** Additional environment variables (e.g., GITLAB_PROFILE, USE_* flags) */
  environment?: Record<string, string>;
  /** Configured GitLab instances */
  instances: GitLabInstance[];
  /** Container name */
  containerName: string;
  /** Docker image */
  image: string;
}

/**
 * Default Docker configuration
 */
export const DEFAULT_DOCKER_CONFIG: DockerConfig = {
  port: 3333,
  oauthEnabled: false,
  instances: [],
  containerName: "gitlab-mcp",
  image: "ghcr.io/structured-world/gitlab-mcp:latest",
};

/**
 * Docker compose service configuration
 */
export interface DockerComposeService {
  image: string;
  container_name: string;
  ports: string[];
  environment: string[];
  volumes: string[];
  restart: string;
}

/**
 * Docker compose file structure
 */
export interface DockerComposeFile {
  version: string;
  services: Record<string, DockerComposeService>;
  volumes?: Record<string, object>;
}

/**
 * Instances YAML file structure
 */
export interface InstancesYaml {
  instances: Record<
    string,
    {
      name: string;
      oauth?: {
        client_id: string;
        client_secret_env: string;
      };
      default_preset?: string;
    }
  >;
}

/**
 * Docker command result
 */
export interface DockerCommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Docker status result
 */
export interface DockerStatusResult {
  dockerInstalled: boolean;
  dockerRunning: boolean;
  composeInstalled: boolean;
  container?: ContainerInfo;
  instances: GitLabInstance[];
  /** Detected container runtime details */
  runtime?: ContainerRuntimeInfo;
}

/**
 * Config directory paths
 */
export const CONFIG_PATHS = {
  darwin: "~/.config/gitlab-mcp",
  win32: "%APPDATA%/gitlab-mcp",
  linux: "~/.config/gitlab-mcp",
} as const;

/**
 * Get config directory for current platform
 */
export function getConfigDir(): string {
  const platform = process.platform as "darwin" | "win32" | "linux";
  return CONFIG_PATHS[platform] ?? CONFIG_PATHS.linux;
}
