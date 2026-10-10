/**
 * Docker utilities for gitlab-mcp container management
 */

import { spawnSync, spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
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
  DEFAULT_DB_IMAGE,
  getConfigDir,
} from './types';
import { getContainerRuntime } from './container-runtime';
import { expandPath } from '../utils/path-utils.js';

// Re-export expandPath for backwards compatibility with existing imports
export { expandPath } from '../utils/path-utils.js';

/**
 * Get expanded config directory path
 */
export function getExpandedConfigDir(): string {
  return expandPath(getConfigDir());
}

/**
 * Check if a container runtime (Docker/Podman) is installed
 */
export function isDockerInstalled(): boolean {
  const runtime = getContainerRuntime();
  return runtime.runtimeVersion !== undefined;
}

/**
 * Check if the container runtime daemon is running
 */
export function isDockerRunning(): boolean {
  const runtime = getContainerRuntime();
  return runtime.runtimeAvailable;
}

/**
 * Check if a compose tool is available for the detected runtime
 */
export function isComposeInstalled(): boolean {
  const runtime = getContainerRuntime();
  return runtime.composeCmd !== null;
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
export function getContainerInfo(containerName: string = 'gitlab-mcp'): ContainerInfo | undefined {
  // Validate container name to prevent command injection
  if (!isValidContainerName(containerName)) {
    console.error(
      `Invalid container name: "${containerName}". Name must match [a-zA-Z0-9][a-zA-Z0-9_.-]*`,
    );
    return undefined;
  }

  try {
    const runtime = getContainerRuntime();
    const result = spawnSync(
      runtime.runtimeCmd,
      [
        'ps',
        '-a',
        '--filter',
        `name=${containerName}`,
        '--format',
        '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}',
      ],
      {
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );

    if (result.status !== 0 || !result.stdout.trim()) {
      return undefined;
    }

    const line = result.stdout.trim().split('\n')[0];
    const parts = line.split('|');

    if (parts.length < 6) {
      return undefined;
    }

    const [id, name, image, statusStr, ports, created] = parts;

    // Parse status
    let status: ContainerStatus = 'exited';
    const statusLower = statusStr.toLowerCase();
    if (statusLower.includes('up')) {
      status = 'running';
    } else if (statusLower.includes('paused')) {
      status = 'paused';
    } else if (statusLower.includes('restarting')) {
      status = 'restarting';
    } else if (statusLower.includes('created')) {
      status = 'created';
    } else if (statusLower.includes('dead')) {
      status = 'dead';
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
      ports: ports ? ports.split(',').map((p) => p.trim()) : [],
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
export function getDockerStatus(containerName: string = 'gitlab-mcp'): DockerStatusResult {
  const runtime = getContainerRuntime();

  const result: DockerStatusResult = {
    dockerInstalled: runtime.runtimeVersion !== undefined,
    dockerRunning: runtime.runtimeAvailable,
    composeInstalled: runtime.composeCmd !== null,
    instances: [],
    runtime,
  };

  if (result.dockerRunning) {
    result.container = getContainerInfo(containerName);
  }

  // Load instances from config
  result.instances = loadInstances();

  return result;
}

/** Connection string of the database bundled by the compose-bundle deployment */
const BUNDLED_POSTGRESQL_URL =
  'postgresql://gitlab_mcp:${POSTGRES_PASSWORD}@postgres:5432/gitlab_mcp';

/**
 * PostgreSQL URL the deployment stores OAuth sessions in, as written into the compose
 * file; undefined when sessions live in a file on the data volume. An external URL
 * carries its password, so it stays in .env and the compose file references it.
 */
function sessionDatabaseUrl(config: DockerConfig): string | undefined {
  if (!config.oauthEnabled) return undefined;
  if (config.deploymentType === 'compose-bundle') return BUNDLED_POSTGRESQL_URL;
  if (config.deploymentType === 'external-db') {
    // The compose file references the URL written to .env; without one Compose would
    // substitute an empty string and the migrations could not start.
    if (!config.databaseUrl) {
      throw new Error('An external-db deployment with OAuth needs the PostgreSQL connection URL');
    }
    return '${OAUTH_STORAGE_POSTGRESQL_URL}';
  }
  return undefined;
}

/**
 * A URL as a literal .env value: Compose interpolates unquoted values (a "$" in a password
 * would be replaced) but keeps single-quoted ones as written. A single quote inside the
 * URL is percent-encoded, which PostgreSQL decodes back to the same connection string.
 */
function envLiteralUrl(url: string): string {
  return `'${url.replaceAll("'", '%27')}'`;
}

/**
 * Generate docker-compose.yml content
 */
export function generateDockerCompose(config: DockerConfig): string {
  const databaseUrl = sessionDatabaseUrl(config);
  const environment = [
    'TRANSPORT=sse',
    'HOST=0.0.0.0',
    'PORT=3333',
    `OAUTH_ENABLED=${config.oauthEnabled}`,
  ];
  const volumes = ['gitlab-mcp-data:/data'];
  const compose: DockerComposeFile = {
    version: '3.8',
    services: {
      'gitlab-mcp': {
        // Only the db image carries the PostgreSQL backend
        image: databaseUrl ? DEFAULT_DB_IMAGE : config.image,
        container_name: config.containerName,
        ports: [`\${PORT:-${config.port}}:3333`],
        environment,
        volumes,
        restart: 'unless-stopped',
      },
    },
    volumes: {
      'gitlab-mcp-data': {},
    },
  };

  // Add OAuth-specific configuration
  if (config.oauthEnabled) {
    // Reference secret via env var — actual value stored in .env file
    environment.push(
      'OAUTH_SESSION_SECRET=${OAUTH_SESSION_SECRET}',
      'OAUTH_ISSUER=${OAUTH_ISSUER}',
    );
    if (databaseUrl) {
      environment.push(
        'OAUTH_STORAGE_TYPE=postgresql',
        `OAUTH_STORAGE_POSTGRESQL_URL=${databaseUrl}`,
      );
    } else {
      // Sessions survive restarts on the data volume
      environment.push(
        'OAUTH_STORAGE_TYPE=file',
        'OAUTH_STORAGE_FILE_PATH=/data/oauth-sessions.json',
      );
    }
    // The instance list (GITLAB_INSTANCES, rewritten whenever instances change) and the
    // instance secrets it names (kept in .env) reach the server at every start.
    compose.services['gitlab-mcp'].env_file = ['.env', INSTANCES_ENV_FILE];
  }

  if (databaseUrl) {
    // One-shot schema migration from the db image; the server starts only after it
    // succeeds. It waits for the database to accept connections itself and baselines a
    // database created before migrations shipped. The bundled database is only started
    // first: podman-compose 1.6.0 on Podman 4.9.3 hangs on `service_healthy`
    // (https://github.com/containers/podman-compose/issues/1541).
    compose.services.migrate = {
      image: DEFAULT_DB_IMAGE,
      restart: 'no',
      working_dir: '/app/node_modules/@structured-world/gitlab-mcp-db',
      entrypoint: ['node', 'dist/src/migrate.js'],
      environment: [`OAUTH_STORAGE_POSTGRESQL_URL=${databaseUrl}`],
      ...(config.deploymentType === 'compose-bundle' && { depends_on: ['postgres'] }),
    };
    compose.services['gitlab-mcp'].depends_on = {
      migrate: { condition: 'service_completed_successfully' },
    };
  }

  // Add compose-bundle postgres service (only when OAuth needs a database)
  if (config.deploymentType === 'compose-bundle' && config.oauthEnabled) {
    compose.services.postgres = {
      image: 'postgres:16-alpine',
      container_name: `${config.containerName}-db`,
      ports: [],
      environment: [
        'POSTGRES_USER=gitlab_mcp',
        'POSTGRES_PASSWORD=${POSTGRES_PASSWORD}',
        'POSTGRES_DB=gitlab_mcp',
      ],
      volumes: ['postgres-data:/var/lib/postgresql/data'],
      restart: 'unless-stopped',
      healthcheck: {
        test: ['CMD-SHELL', 'pg_isready -U gitlab_mcp'],
        interval: '5s',
        timeout: '5s',
        retries: 5,
      },
    };
    if (compose.volumes) {
      compose.volumes['postgres-data'] = {};
    }
  }

  // Add tool configuration environment variables
  if (config.environment) {
    for (const [key, value] of Object.entries(config.environment)) {
      environment.push(`${key}=${value}`);
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
  const instancesPath = join(configDir, 'instances.yml');

  if (!existsSync(instancesPath)) {
    return [];
  }

  try {
    const content = readFileSync(instancesPath, 'utf8');
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

  const instancesPath = join(configDir, 'instances.yml');
  const content = generateInstancesYaml(instances);
  writeFileSync(instancesPath, content, 'utf8');
  saveServerInstances(instances);
}

/** Env file holding the server's instance list, next to the compose file. */
const INSTANCES_ENV_FILE = 'instances.env';
/** JSON escape of a single quote: a backslash followed by u0027. */
const JSON_QUOTE_ESCAPE = `${String.fromCodePoint(92)}u0027`;

/**
 * Write the instances as the server reads them: GITLAB_INSTANCES with the configuration
 * object the server validates. Secrets stay in .env; each instance names its variable.
 */
function saveServerInstances(instances: GitLabInstance[]): void {
  const configDir = getExpandedConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  let value = '';
  if (instances.length > 0) {
    const config = {
      instances: instances.map((instance) => ({
        url: instance.host.includes('://') ? instance.host : `https://${instance.host}`,
        label: instance.name,
        ...(instance.oauth && {
          oauth: {
            clientId: instance.oauth.clientId,
            clientSecretEnv: instance.oauth.clientSecretEnv,
          },
        }),
      })),
    };
    // Single-quoted env values are literal and cannot contain a single quote; JSON spells
    // it as the escape backslash-u0027 instead.
    value = `'${JSON.stringify(config).replaceAll("'", JSON_QUOTE_ESCAPE)}'`;
  }
  writeFileSync(join(configDir, INSTANCES_ENV_FILE), `GITLAB_INSTANCES=${value}\n`, 'utf8');
}

/**
 * Save docker-compose.yml to config directory
 */
export function saveDockerCompose(config: DockerConfig): void {
  const configDir = getExpandedConfigDir();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const composePath = join(configDir, 'docker-compose.yml');
  const content = generateDockerCompose(config);
  writeFileSync(composePath, content, 'utf8');
}

/**
 * Run docker compose command
 */
export function runComposeCommand(args: string[], configDir?: string): DockerCommandResult {
  const cwd = configDir ?? getExpandedConfigDir();

  // Check if docker-compose.yml exists
  const composePath = join(cwd, 'docker-compose.yml');
  if (!existsSync(composePath)) {
    return {
      success: false,
      error: `docker-compose.yml not found in ${cwd}. Run 'gitlab-mcp docker init' first.`,
    };
  }

  const runtime = getContainerRuntime();
  if (!runtime.composeCmd) {
    return {
      success: false,
      error: 'No compose tool available. Install docker-compose or podman-compose.',
    };
  }

  try {
    // Use the detected compose command
    const [composeExe, ...composePrefix] = runtime.composeCmd;
    const fullArgs = [...composePrefix, ...args];

    const result = spawnSync(composeExe, fullArgs, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    if (result.status === 0) {
      return {
        success: true,
        output: result.stdout,
      };
    } else {
      return {
        success: false,
        error: result.stderr || result.stdout || 'Unknown error',
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
  return runComposeCommand(['up', '-d']);
}

/**
 * Stop container
 */
export function stopContainer(): DockerCommandResult {
  return runComposeCommand(['down']);
}

/**
 * Restart container
 */
export function restartContainer(): DockerCommandResult {
  return runComposeCommand(['restart']);
}

/**
 * Pull latest image and restart
 */
export function upgradeContainer(): DockerCommandResult {
  const pullResult = runComposeCommand(['pull']);
  if (!pullResult.success) {
    return pullResult;
  }

  return runComposeCommand(['up', '-d']);
}

/**
 * Get container logs (returns process for streaming)
 */
export function tailLogs(follow: boolean = true, lines: number = 100): ChildProcess {
  const configDir = getExpandedConfigDir();
  const runtime = getContainerRuntime();

  if (!runtime.composeCmd) {
    throw new Error('No compose tool available. Install Docker Compose or podman-compose.');
  }
  const [composeExe, ...composePrefix] = runtime.composeCmd;

  const args = [...composePrefix, 'logs'];

  if (follow) {
    args.push('-f');
  }

  args.push('--tail', String(lines));

  return spawn(composeExe, args, {
    cwd: configDir,
    stdio: 'inherit',
  });
}

/**
 * Get container logs (non-streaming)
 */
export function getLogs(lines: number = 100): DockerCommandResult {
  return runComposeCommand(['logs', '--tail', String(lines)]);
}

/**
 * Add a GitLab instance to configuration
 */
export function addInstance(instance: GitLabInstance): void {
  const instances = loadInstances();

  // Check if already exists
  const existingIndex = instances.findIndex((i) => i.host === instance.host);
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
  const filteredInstances = instances.filter((i) => i.host !== host);

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

  // Write .env file with secrets (restricted permissions)
  saveEnvFile(fullConfig);

  // Save instances if provided; an OAuth deployment's compose file names the server's
  // instance list, so it exists from the start
  if (fullConfig.instances.length > 0) {
    saveInstances(fullConfig.instances);
  } else if (fullConfig.oauthEnabled) {
    saveServerInstances([]);
  }

  return fullConfig;
}

/**
 * Write .env file with secrets for docker-compose environment variable references.
 * File is created with 0600 permissions to limit exposure.
 */
export function saveEnvFile(config: DockerConfig): void {
  const configDir = getExpandedConfigDir();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const lines: string[] = [];

  if (config.oauthSessionSecret) {
    lines.push(`OAUTH_SESSION_SECRET=${config.oauthSessionSecret}`);
  }

  if (config.oauthEnabled) {
    // The public URL chosen during setup; without one, local access on the published port.
    const issuer = config.oauthIssuer ?? `http://localhost:${config.port}`;
    lines.push(`OAUTH_ISSUER=${issuer}`);
  }

  if (config.deploymentType === 'compose-bundle' && config.oauthEnabled) {
    // Generate a strong random postgres password for the bundled database
    const pgPassword = randomBytes(24).toString('base64url');
    lines.push(`POSTGRES_PASSWORD=${pgPassword}`);
  }

  if (config.deploymentType === 'external-db' && config.oauthEnabled && config.databaseUrl) {
    // The compose file references it; the URL carries the database password
    lines.push(`OAUTH_STORAGE_POSTGRESQL_URL=${envLiteralUrl(config.databaseUrl)}`);
  }

  if (lines.length > 0) {
    const envPath = join(configDir, '.env');
    writeFileSync(envPath, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  }
}
