/**
 * Unit tests for docker/docker-utils.ts
 * Tests Docker utility functions
 */

import {
  expandPath,
  generateDockerCompose,
  generateInstancesYaml,
  loadInstances,
  saveInstances,
  isDockerInstalled,
  isDockerRunning,
  isComposeInstalled,
  getContainerInfo,
  getDockerStatus,
  startContainer,
  stopContainer,
  restartContainer,
  upgradeContainer,
  getLogs,
  tailLogs,
  addInstance,
  removeInstance,
  initDockerConfig,
  saveEnvFile,
  getExpandedConfigDir,
} from '../../../../src/cli/docker/docker-utils';
import {
  DockerConfig,
  GitLabInstance,
  ContainerRuntimeInfo,
  DEFAULT_DOCKER_CONFIG,
  DEFAULT_DB_IMAGE,
} from '../../../../src/cli/docker/types';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import YAML from 'yaml';
import { homedir } from 'os';
import { validateInstancesConfig } from '../../../../src/config/instances-schema';
import { join } from 'path';

// Mock modules
jest.mock('fs');
jest.mock('child_process');
jest.mock('../../../../src/cli/docker/container-runtime');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;

import { getContainerRuntime } from '../../../../src/cli/docker/container-runtime';
const mockGetContainerRuntime = getContainerRuntime as jest.MockedFunction<
  typeof getContainerRuntime
>;

// Default Docker runtime mock
const dockerRuntime: ContainerRuntimeInfo = {
  runtime: 'docker',
  runtimeCmd: 'docker',
  runtimeAvailable: true,
  composeCmd: ['docker', 'compose'],
  runtimeVersion: '24.0.7',
};

// Podman runtime mock
const podmanRuntime: ContainerRuntimeInfo = {
  runtime: 'podman',
  runtimeCmd: 'podman',
  runtimeAvailable: true,
  composeCmd: ['podman', 'compose'],
  runtimeVersion: '4.9.3',
};

describe('docker-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: Docker runtime available with compose
    mockGetContainerRuntime.mockReturnValue(dockerRuntime);
  });

  describe('expandPath', () => {
    it('should expand home directory (~)', () => {
      const result = expandPath('~/test/path');
      expect(result).toBe(join(homedir(), 'test/path'));
    });

    it('should not modify absolute paths', () => {
      const result = expandPath('/absolute/path');
      expect(result).toBe('/absolute/path');
    });

    it('should not modify relative paths without ~', () => {
      const result = expandPath('relative/path');
      expect(result).toBe('relative/path');
    });
  });

  describe('getExpandedConfigDir', () => {
    it('should return expanded config directory path', () => {
      const result = getExpandedConfigDir();
      expect(result).toContain(homedir());
      expect(result).toContain('gitlab-mcp');
    });
  });

  describe('isDockerInstalled', () => {
    it('should return true when runtime has a version', () => {
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);

      const result = isDockerInstalled();

      expect(result).toBe(true);
    });

    it('should return false when runtime has no version', () => {
      mockGetContainerRuntime.mockReturnValue({
        ...dockerRuntime,
        runtimeVersion: undefined,
      });

      const result = isDockerInstalled();

      expect(result).toBe(false);
    });

    it('should return true for podman runtime', () => {
      mockGetContainerRuntime.mockReturnValue(podmanRuntime);

      const result = isDockerInstalled();

      expect(result).toBe(true);
    });
  });

  describe('isDockerRunning', () => {
    it('should return true when runtime is available', () => {
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);

      const result = isDockerRunning();

      expect(result).toBe(true);
    });

    it('should return false when runtime is not available', () => {
      mockGetContainerRuntime.mockReturnValue({
        ...dockerRuntime,
        runtimeAvailable: false,
      });

      const result = isDockerRunning();

      expect(result).toBe(false);
    });

    it('should return true for podman runtime when available', () => {
      mockGetContainerRuntime.mockReturnValue(podmanRuntime);

      const result = isDockerRunning();

      expect(result).toBe(true);
    });
  });

  describe('isComposeInstalled', () => {
    it('should return true when composeCmd is set', () => {
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);

      const result = isComposeInstalled();

      expect(result).toBe(true);
    });

    it('should return false when composeCmd is null', () => {
      mockGetContainerRuntime.mockReturnValue({
        ...dockerRuntime,
        composeCmd: null,
      });

      const result = isComposeInstalled();

      expect(result).toBe(false);
    });

    it('should return true for podman-compose', () => {
      mockGetContainerRuntime.mockReturnValue({
        ...podmanRuntime,
        composeCmd: ['podman-compose'],
      });

      const result = isComposeInstalled();

      expect(result).toBe(true);
    });
  });

  describe('getContainerInfo', () => {
    it('should return container info when container exists', () => {
      // Format: {{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout:
          'abc123|gitlab-mcp|gitlab-mcp:latest|Up 2 hours|0.0.0.0:3333->3333/tcp|2024-01-01 00:00:00',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result).toBeDefined();
      expect(result?.name).toBe('gitlab-mcp');
      expect(result?.status).toBe('running');
    });

    it('should return undefined when container does not exist', () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result).toBeUndefined();
    });

    it('should return undefined on error', () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'error',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid container name', () => {
      const result = getContainerInfo('invalid;name');

      expect(result).toBeUndefined();
    });

    it('should return undefined when output has less than 6 parts', () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'abc123|gitlab-mcp|gitlab-mcp:latest',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result).toBeUndefined();
    });

    it('should parse paused status', () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'abc123|gitlab-mcp|gitlab-mcp:latest|Paused 2 hours|ports|2024-01-01',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result?.status).toBe('paused');
    });

    it('should parse restarting status', () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'abc123|gitlab-mcp|gitlab-mcp:latest|Restarting (1)|ports|2024-01-01',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result?.status).toBe('restarting');
    });

    it('should parse created status', () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'abc123|gitlab-mcp|gitlab-mcp:latest|Created 2 hours|ports|2024-01-01',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result?.status).toBe('created');
    });

    it('should parse dead status', () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'abc123|gitlab-mcp|gitlab-mcp:latest|Dead|ports|2024-01-01',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result?.status).toBe('dead');
    });
  });

  describe('getDockerStatus', () => {
    it('should return full status from runtime info', () => {
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);
      // getContainerInfo will be called since runtimeAvailable is true
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });
      mockFs.existsSync.mockReturnValue(false);

      const result = getDockerStatus();

      expect(result.dockerInstalled).toBe(true);
      expect(result.dockerRunning).toBe(true);
      expect(result.composeInstalled).toBe(true);
      expect(result.runtime).toBe(dockerRuntime);
    });

    it('should include runtime info for podman', () => {
      mockGetContainerRuntime.mockReturnValue(podmanRuntime);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });
      mockFs.existsSync.mockReturnValue(false);

      const result = getDockerStatus();

      expect(result.dockerInstalled).toBe(true);
      expect(result.runtime?.runtime).toBe('podman');
    });

    it('should not query container when runtime unavailable', () => {
      mockGetContainerRuntime.mockReturnValue({
        ...dockerRuntime,
        runtimeAvailable: false,
        runtimeVersion: undefined,
      });
      mockFs.existsSync.mockReturnValue(false);

      const result = getDockerStatus();

      expect(result.dockerInstalled).toBe(false);
      expect(result.dockerRunning).toBe(false);
      expect(result.container).toBeUndefined();
      // spawnSync should NOT be called for container check
      expect(mockChildProcess.spawnSync).not.toHaveBeenCalled();
    });
  });

  describe('startContainer', () => {
    it('should start container successfully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'Container started',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = startContainer();

      expect(result.success).toBe(true);
    });

    it('should return error if config not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = startContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('stopContainer', () => {
    it('should stop container successfully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'Container stopped',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = stopContainer();

      expect(result.success).toBe(true);
    });
  });

  describe('restartContainer', () => {
    it('should restart container successfully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'Container restarted',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = restartContainer();

      expect(result.success).toBe(true);
    });
  });

  describe('upgradeContainer', () => {
    it('should upgrade container successfully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'Pulled latest',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = upgradeContainer();

      expect(result.success).toBe(true);
    });

    it('should return error if pull fails', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'Failed to pull image',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = upgradeContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to pull image');
    });
  });

  describe('getLogs', () => {
    it('should get logs successfully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'Log output here',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getLogs(100);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Log output here');
    });
  });

  describe('generateDockerCompose', () => {
    it('should generate valid docker-compose YAML', () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: false,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.version).toBe('3.8');
      expect(parsed.services['gitlab-mcp']).toBeDefined();
      expect(parsed.services['gitlab-mcp'].image).toBe(config.image);
      expect(parsed.services['gitlab-mcp'].container_name).toBe(config.containerName);
    });

    it('should include port mapping', () => {
      const config: DockerConfig = {
        port: 4444,
        oauthEnabled: false,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services['gitlab-mcp'].ports[0]).toContain('4444');
    });

    it('should reference OAuth secret via env var (not plaintext)', () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: true,
        oauthSessionSecret: 'test-secret',
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services['gitlab-mcp'].environment).toContain('OAUTH_ENABLED=true');
      // Secret is referenced via env var, not embedded directly
      expect(parsed.services['gitlab-mcp'].environment).toContain(
        'OAUTH_SESSION_SECRET=${OAUTH_SESSION_SECRET}',
      );
    });

    // Standalone OAuth keeps sessions in a file on the data volume: the server reads
    // OAUTH_STORAGE_TYPE/OAUTH_STORAGE_FILE_PATH, a DATABASE_URL alone selects nothing
    // and left sessions in memory, lost on every restart.
    it('should store standalone OAuth sessions in a file on the data volume', () => {
      const config: DockerConfig = {
        ...DEFAULT_DOCKER_CONFIG,
        deploymentType: 'standalone',
        oauthEnabled: true,
      };

      const parsed = YAML.parse(generateDockerCompose(config));
      const service = parsed.services['gitlab-mcp'];

      expect(service.image).toBe(DEFAULT_DOCKER_CONFIG.image);
      expect(service.environment).toContain('OAUTH_STORAGE_TYPE=file');
      expect(service.environment).toContain('OAUTH_STORAGE_FILE_PATH=/data/oauth-sessions.json');
      expect(service.volumes).toContain('gitlab-mcp-data:/data');
      expect(service.environment.some((entry: string) => entry.startsWith('DATABASE_URL='))).toBe(
        false,
      );
      expect(parsed.services.migrate).toBeUndefined();
    });

    // External PostgreSQL needs the db image (core has no PostgreSQL backend), the
    // storage selection, migrations before start, and the URL kept in .env because it
    // carries the database password.
    it('should run external-db deployments on the db image with migrations', () => {
      const config: DockerConfig = {
        ...DEFAULT_DOCKER_CONFIG,
        deploymentType: 'external-db',
        oauthEnabled: true,
        databaseUrl: 'postgresql://user:pass@host:5432/db',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);
      const service = parsed.services['gitlab-mcp'];

      expect(service.image).toBe(DEFAULT_DB_IMAGE);
      expect(service.environment).toContain('OAUTH_STORAGE_TYPE=postgresql');
      expect(service.environment).toContain(
        'OAUTH_STORAGE_POSTGRESQL_URL=${OAUTH_STORAGE_POSTGRESQL_URL}',
      );
      expect(result).not.toContain('user:pass');
      expect(service.depends_on).toEqual({
        migrate: { condition: 'service_completed_successfully' },
      });

      expect(parsed.services.migrate).toEqual({
        image: DEFAULT_DB_IMAGE,
        restart: 'no',
        working_dir: '/app/node_modules/@structured-world/gitlab-mcp-db',
        entrypoint: ['node', 'dist/src/migrate.js'],
        environment: ['OAUTH_STORAGE_POSTGRESQL_URL=${OAUTH_STORAGE_POSTGRESQL_URL}'],
      });
      expect(parsed.services.postgres).toBeUndefined();
    });

    // Without a URL the compose file would reference an empty variable and migrations
    // would fail at start; refuse before any file is written.
    it('refuses an external-db OAuth deployment without a database URL', () => {
      expect(() =>
        generateDockerCompose({
          ...DEFAULT_DOCKER_CONFIG,
          deploymentType: 'external-db',
          oauthEnabled: true,
        }),
      ).toThrow('An external-db deployment with OAuth needs the PostgreSQL connection URL');
    });

    it('should add postgres service for compose-bundle deployment', () => {
      const config: DockerConfig = {
        port: 3333,
        deploymentType: 'compose-bundle',
        oauthEnabled: true,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      // Postgres service added
      expect(parsed.services.postgres).toBeDefined();
      expect(parsed.services.postgres.image).toBe('postgres:16-alpine');
      expect(parsed.services.postgres.container_name).toBe('gitlab-mcp-db');
      expect(parsed.services.postgres.environment).toContain('POSTGRES_DB=gitlab_mcp');
      // Migrations wait for a database that accepts connections
      expect(parsed.services.postgres.healthcheck.test).toEqual([
        'CMD-SHELL',
        'pg_isready -U gitlab_mcp',
      ]);

      // The server runs on the db image, selects PostgreSQL storage, and points it at
      // the bundled database
      const bundledUrl = 'postgresql://gitlab_mcp:${POSTGRES_PASSWORD}@postgres:5432/gitlab_mcp';
      expect(parsed.services['gitlab-mcp'].image).toBe(DEFAULT_DB_IMAGE);
      expect(parsed.services['gitlab-mcp'].environment).toContain('OAUTH_STORAGE_TYPE=postgresql');
      expect(parsed.services['gitlab-mcp'].environment).toContain(
        `OAUTH_STORAGE_POSTGRESQL_URL=${bundledUrl}`,
      );

      // Order: postgres started -> migrations applied (they wait for the database to
      // accept connections themselves) -> server. No health condition: podman-compose
      // 1.6.0 on Podman 4.9.3 hangs on service_healthy.
      expect(parsed.services.migrate.environment).toEqual([
        `OAUTH_STORAGE_POSTGRESQL_URL=${bundledUrl}`,
      ]);
      expect(parsed.services.migrate.depends_on).toEqual(['postgres']);
      expect(parsed.services['gitlab-mcp'].depends_on).toEqual({
        migrate: { condition: 'service_completed_successfully' },
      });

      // postgres-data volume added
      expect(parsed.volumes['postgres-data']).toBeDefined();
    });

    it('should not add postgres for compose-bundle without OAuth', () => {
      const config: DockerConfig = {
        port: 3333,
        deploymentType: 'compose-bundle',
        oauthEnabled: false,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      // Postgres service should NOT be added without OAuth
      expect(parsed.services.postgres).toBeUndefined();
      expect(parsed.services.migrate).toBeUndefined();
      expect(parsed.services['gitlab-mcp'].image).toBe(DEFAULT_DOCKER_CONFIG.image);
      expect(parsed.services['gitlab-mcp'].depends_on).toBeUndefined();
      expect(parsed.volumes['postgres-data']).toBeUndefined();
    });

    it('should include volume for data', () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: false,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services['gitlab-mcp'].volumes).toContain('gitlab-mcp-data:/data');
      expect(parsed.volumes['gitlab-mcp-data']).toBeDefined();
    });

    // The server reads its instances from GITLAB_INSTANCES and instance secrets from the
    // variables they name; the CLI's own instances.yml format is not the server's.
    it('passes the instance list and secrets to an OAuth server through env files', () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: true,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services['gitlab-mcp'].env_file).toEqual(['.env', 'instances.env']);
      expect(parsed.services['gitlab-mcp'].volumes).not.toContain(
        './instances.yml:/app/config/instances.yml:ro',
      );
    });

    it('should set restart policy to unless-stopped', () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: false,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services['gitlab-mcp'].restart).toBe('unless-stopped');
    });

    it('should include custom environment variables from config', () => {
      const config: DockerConfig = {
        ...DEFAULT_DOCKER_CONFIG,
        environment: {
          GITLAB_PROFILE: 'developer',
          USE_WORKITEMS: 'false',
        },
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services['gitlab-mcp'].environment).toContain('GITLAB_PROFILE=developer');
      expect(parsed.services['gitlab-mcp'].environment).toContain('USE_WORKITEMS=false');
    });

    it('should not add environment entries when environment is undefined', () => {
      const config: DockerConfig = {
        ...DEFAULT_DOCKER_CONFIG,
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);
      const env = parsed.services['gitlab-mcp'].environment;

      // Only default entries
      expect(env).toContain('TRANSPORT=sse');
      expect(env).toContain('HOST=0.0.0.0');
      expect(env).toContain('PORT=3333');
      expect(env.length).toBe(4); // TRANSPORT, HOST, PORT, OAUTH_ENABLED
    });
  });

  describe('generateInstancesYaml', () => {
    it('should generate empty instances YAML for empty array', () => {
      const result = generateInstancesYaml([]);
      const parsed = YAML.parse(result);

      expect(parsed.instances).toEqual({});
    });

    it('should generate instances YAML with basic info', () => {
      const instances: GitLabInstance[] = [
        {
          host: 'gitlab.com',
          name: 'GitLab.com',
        },
      ];

      const result = generateInstancesYaml(instances);
      const parsed = YAML.parse(result);

      expect(parsed.instances['gitlab.com']).toBeDefined();
      expect(parsed.instances['gitlab.com'].name).toBe('GitLab.com');
    });

    it('should include OAuth configuration', () => {
      const instances: GitLabInstance[] = [
        {
          host: 'gitlab.company.com',
          name: 'Company GitLab',
          oauth: {
            clientId: 'abc123',
            clientSecretEnv: 'GITLAB_COMPANY_SECRET',
          },
        },
      ];

      const result = generateInstancesYaml(instances);
      const parsed = YAML.parse(result);

      expect(parsed.instances['gitlab.company.com'].oauth).toBeDefined();
      expect(parsed.instances['gitlab.company.com'].oauth.client_id).toBe('abc123');
      expect(parsed.instances['gitlab.company.com'].oauth.client_secret_env).toBe(
        'GITLAB_COMPANY_SECRET',
      );
    });

    it('should include default preset', () => {
      const instances: GitLabInstance[] = [
        {
          host: 'gitlab.com',
          name: 'GitLab.com',
          defaultPreset: 'developer',
        },
      ];

      const result = generateInstancesYaml(instances);
      const parsed = YAML.parse(result);

      expect(parsed.instances['gitlab.com'].default_preset).toBe('developer');
    });

    it('should handle multiple instances', () => {
      const instances: GitLabInstance[] = [
        { host: 'gitlab.com', name: 'GitLab.com' },
        { host: 'gitlab.company.com', name: 'Company' },
      ];

      const result = generateInstancesYaml(instances);
      const parsed = YAML.parse(result);

      expect(Object.keys(parsed.instances)).toHaveLength(2);
    });
  });

  describe('loadInstances', () => {
    it('should return empty array if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = loadInstances();

      expect(result).toEqual([]);
    });

    it('should parse instances from YAML file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            'gitlab.com': {
              name: 'GitLab.com',
            },
          },
        }),
      );

      const result = loadInstances();

      expect(result).toHaveLength(1);
      expect(result[0].host).toBe('gitlab.com');
      expect(result[0].name).toBe('GitLab.com');
    });

    it('should parse OAuth configuration', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            'gitlab.company.com': {
              name: 'Company',
              oauth: {
                client_id: 'abc123',
                client_secret_env: 'SECRET_VAR',
              },
            },
          },
        }),
      );

      const result = loadInstances();

      expect(result[0].oauth).toBeDefined();
      expect(result[0].oauth?.clientId).toBe('abc123');
      expect(result[0].oauth?.clientSecretEnv).toBe('SECRET_VAR');
    });

    it('should return empty array on parse error', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid: yaml: content:');

      const result = loadInstances();

      expect(result).toEqual([]);
    });
  });

  describe('saveInstances', () => {
    it('should create config directory if not exists', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveInstances([{ host: 'gitlab.com', name: 'GitLab' }]);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('should write YAML to file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const instances: GitLabInstance[] = [{ host: 'gitlab.com', name: 'GitLab' }];

      saveInstances(instances);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      expect(writeCall[0]).toContain('instances.yml');
    });

    // The container reads instances.env at every start, so instances added later reach the
    // server without regenerating the compose file.
    it('writes the instances for the server in the format it validates', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveInstances([
        {
          host: 'git.corp.io',
          name: "Corp's GitLab",
          oauth: { clientId: 'corp-app', clientSecretEnv: 'GIT_CORP_IO_SECRET' },
        },
        { host: 'https://gitlab.example.com/gitlab', name: 'Subpath' },
      ]);

      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        String(call[0]).endsWith('instances.env'),
      );
      const line = String(envCall![1]).trim();
      expect(line.startsWith("GITLAB_INSTANCES='")).toBe(true);
      const json = line.slice("GITLAB_INSTANCES='".length, -1);
      // Single-quoted env values are literal and cannot contain a single quote.
      expect(json).not.toContain("'");
      const parsed = validateInstancesConfig(JSON.parse(json));
      expect(parsed.instances).toEqual([
        expect.objectContaining({
          url: 'https://git.corp.io',
          label: "Corp's GitLab",
          oauth: expect.objectContaining({
            clientId: 'corp-app',
            clientSecretEnv: 'GIT_CORP_IO_SECRET',
          }),
        }),
        expect.objectContaining({ url: 'https://gitlab.example.com/gitlab', label: 'Subpath' }),
      ]);
    });

    it('writes an empty instance list when there are no instances', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveInstances([]);

      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        String(call[0]).endsWith('instances.env'),
      );
      expect(envCall![1]).toBe('GITLAB_INSTANCES=\n');
    });
  });

  describe('addInstance', () => {
    it('should add new instance to empty list', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const instance: GitLabInstance = { host: 'gitlab.com', name: 'GitLab' };
      addInstance(instance);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should add instance to existing list', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            'gitlab.com': { name: 'GitLab' },
          },
        }),
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const instance: GitLabInstance = { host: 'gitlab.company.com', name: 'Company' };
      addInstance(instance);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should update existing instance with same host', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            'gitlab.com': { name: 'GitLab' },
          },
        }),
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const updatedInstance: GitLabInstance = { host: 'gitlab.com', name: 'Updated GitLab' };
      addInstance(updatedInstance);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const content = writeCall[1] as string;
      expect(content).toContain('Updated GitLab');
    });
  });

  describe('removeInstance', () => {
    it('should return false when instance not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = removeInstance('unknown.com');

      expect(result).toBe(false);
    });

    it('should remove instance and return true', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            'gitlab.com': { name: 'GitLab' },
          },
        }),
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const result = removeInstance('gitlab.com');

      expect(result).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('initDockerConfig', () => {
    it('should create config files', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: false,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      initDockerConfig(config);

      expect(mockFs.mkdirSync).toHaveBeenCalled();
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should save instances when provided', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: true,
        instances: [{ host: 'gitlab.com', name: 'GitLab' }],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      initDockerConfig(config);

      // docker-compose.yml, .env (OAUTH_ISSUER, required in OAuth mode), instances.yml and
      // the server's instances.env
      const written = mockFs.writeFileSync.mock.calls.map((call) => String(call[0]));
      expect(written).toHaveLength(4);
      expect(written.some((path) => path.endsWith('instances.yml'))).toBe(true);
      expect(written.some((path) => path.endsWith('instances.env'))).toBe(true);
    });

    // The compose file names instances.env, so it exists even before any instance is added.
    it('writes the instance list of an OAuth deployment without instances', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      initDockerConfig({
        port: 3333,
        oauthEnabled: true,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      });

      const written = mockFs.writeFileSync.mock.calls.map((call) => String(call[0]));
      expect(written.some((path) => path.endsWith('instances.env'))).toBe(true);
    });

    it('should give an OAuth deployment its public URL in .env and compose', () => {
      // The server refuses to start in OAuth mode without OAUTH_ISSUER.
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      initDockerConfig({
        port: 4444,
        oauthEnabled: true,
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      });

      const files = mockFs.writeFileSync.mock.calls.map((call) => [
        String(call[0]),
        String(call[1]),
      ]);
      expect(files.find(([path]) => path.endsWith('.env'))?.[1]).toContain(
        'OAUTH_ISSUER=http://localhost:4444',
      );
      expect(files.find(([path]) => path.endsWith('docker-compose.yml'))?.[1]).toContain(
        'OAUTH_ISSUER=${OAUTH_ISSUER}',
      );
    });

    it('should write .env file when oauthSessionSecret is set', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: true,
        oauthSessionSecret: 'abc123secret',
        instances: [],
        containerName: 'gitlab-mcp',
        image: 'ghcr.io/structured-world/gitlab-mcp:latest',
      };

      initDockerConfig(config);

      // .env file should be written with restricted permissions
      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        (call[0] as string).endsWith('.env'),
      );
      expect(envCall).toBeDefined();
      expect(envCall![1]).toContain('OAUTH_SESSION_SECRET=abc123secret');
      expect(envCall![2]).toEqual({ encoding: 'utf8', mode: 0o600 });
    });
  });

  describe('saveEnvFile', () => {
    it('should not write .env when no secrets present', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveEnvFile({ ...DEFAULT_DOCKER_CONFIG });

      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        (call[0] as string).endsWith('.env'),
      );
      expect(envCall).toBeUndefined();
    });

    it('should include POSTGRES_PASSWORD for compose-bundle with OAuth', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveEnvFile({
        ...DEFAULT_DOCKER_CONFIG,
        deploymentType: 'compose-bundle',
        oauthEnabled: true,
        oauthSessionSecret: 'a]b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
      });

      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        (call[0] as string).endsWith('.env'),
      );
      expect(envCall).toBeDefined();
      const content = envCall![1] as string;
      expect(content).toContain('POSTGRES_PASSWORD=');
      expect(content).toContain('OAUTH_SESSION_SECRET=');
      // Password should be a strong random value, not the weak default
      const match = content.match(/POSTGRES_PASSWORD=(.+)/);
      expect(match).toBeDefined();
      expect(match![1].length).toBeGreaterThanOrEqual(20);
    });

    it('should write the public URL chosen during setup as OAUTH_ISSUER', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveEnvFile({
        ...DEFAULT_DOCKER_CONFIG,
        oauthEnabled: true,
        oauthIssuer: 'https://mcp.example.com',
      });

      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        (call[0] as string).endsWith('.env'),
      );
      expect(envCall![1]).toContain('OAUTH_ISSUER=https://mcp.example.com\n');
      expect(envCall![1]).not.toContain('localhost');
    });

    // The external database URL carries its password, so it lives in the 0600 .env
    // file and the compose file only references it.
    it('should write the external PostgreSQL URL for external-db with OAuth', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveEnvFile({
        ...DEFAULT_DOCKER_CONFIG,
        deploymentType: 'external-db',
        oauthEnabled: true,
        databaseUrl: 'postgresql://user:pass@host:5432/db',
      });

      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        (call[0] as string).endsWith('.env'),
      );
      expect(envCall).toBeDefined();
      expect(envCall![1]).toContain(
        "OAUTH_STORAGE_POSTGRESQL_URL='postgresql://user:pass@host:5432/db'\n",
      );
      expect(envCall![1]).not.toContain('POSTGRES_PASSWORD=');
      expect(envCall![2]).toEqual({ encoding: 'utf8', mode: 0o600 });
    });

    // Compose interpolates unquoted .env values: a "$" in the password would be replaced.
    // Single-quoted values are literal.
    it('writes the external database URL as a literal value', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveEnvFile({
        ...DEFAULT_DOCKER_CONFIG,
        deploymentType: 'external-db',
        oauthEnabled: true,
        databaseUrl: 'postgresql://user:pa$word@host:5432/db',
      });

      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        (call[0] as string).endsWith('.env'),
      );
      expect(envCall![1]).toContain(
        "OAUTH_STORAGE_POSTGRESQL_URL='postgresql://user:pa$word@host:5432/db'\n",
      );
    });

    it('should not include POSTGRES_PASSWORD for compose-bundle without OAuth', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveEnvFile({
        ...DEFAULT_DOCKER_CONFIG,
        deploymentType: 'compose-bundle',
        oauthEnabled: false,
      });

      const envCall = mockFs.writeFileSync.mock.calls.find((call) =>
        (call[0] as string).endsWith('.env'),
      );
      // No secrets to write, so no .env file created
      expect(envCall).toBeUndefined();
    });

    it('should create config directory if not exists', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveEnvFile({
        ...DEFAULT_DOCKER_CONFIG,
        oauthSessionSecret: 'test-secret',
      });

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });
  });

  describe('runComposeCommand - runtime integration', () => {
    it('should use compose command from runtime', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'Success',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = startContainer();

      expect(result.success).toBe(true);
      // Should call with "docker" and ["compose", "up", "-d"]
      expect(mockChildProcess.spawnSync).toHaveBeenCalledWith(
        'docker',
        ['compose', 'up', '-d'],
        expect.any(Object),
      );
    });

    it('should use podman-compose when runtime is podman with standalone compose', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockGetContainerRuntime.mockReturnValue({
        ...podmanRuntime,
        composeCmd: ['podman-compose'],
      });
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: 'Success',
        stderr: '',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = startContainer();

      expect(result.success).toBe(true);
      // Should call "podman-compose" with ["up", "-d"]
      expect(mockChildProcess.spawnSync).toHaveBeenCalledWith(
        'podman-compose',
        ['up', '-d'],
        expect.any(Object),
      );
    });

    it('should return error when no compose tool is available', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockGetContainerRuntime.mockReturnValue({
        ...dockerRuntime,
        composeCmd: null,
      });

      const result = startContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No compose tool available');
    });

    it('should return error when command fails', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'Some error occurred',
        pid: 123,
        output: [],
        signal: null,
      });

      const result = stopContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Some error occurred');
    });

    it('should handle exception in runComposeCommand', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = restartContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected error');
    });
  });

  describe('tailLogs', () => {
    const mockProcess = { pid: 999 } as any;

    it('should use compose command from runtime with follow mode', () => {
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);
      mockChildProcess.spawn.mockReturnValue(mockProcess);

      const result = tailLogs(true, 50);

      expect(result).toBe(mockProcess);
      expect(mockChildProcess.spawn).toHaveBeenCalledWith(
        'docker',
        ['compose', 'logs', '-f', '--tail', '50'],
        expect.objectContaining({ stdio: 'inherit' }),
      );
    });

    it('should omit -f flag when follow is false', () => {
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);
      mockChildProcess.spawn.mockReturnValue(mockProcess);

      tailLogs(false, 200);

      expect(mockChildProcess.spawn).toHaveBeenCalledWith(
        'docker',
        ['compose', 'logs', '--tail', '200'],
        expect.any(Object),
      );
    });

    it('should use podman-compose when runtime is podman', () => {
      mockGetContainerRuntime.mockReturnValue({
        ...podmanRuntime,
        composeCmd: ['podman-compose'],
      });
      mockChildProcess.spawn.mockReturnValue(mockProcess);

      tailLogs(true, 100);

      expect(mockChildProcess.spawn).toHaveBeenCalledWith(
        'podman-compose',
        ['logs', '-f', '--tail', '100'],
        expect.any(Object),
      );
    });

    it('should throw when composeCmd is null', () => {
      mockGetContainerRuntime.mockReturnValue({
        ...dockerRuntime,
        composeCmd: null,
      });

      expect(() => tailLogs(true, 100)).toThrow(
        'No compose tool available. Install Docker Compose or podman-compose.',
      );
      expect(mockChildProcess.spawn).not.toHaveBeenCalled();
    });
  });
});
