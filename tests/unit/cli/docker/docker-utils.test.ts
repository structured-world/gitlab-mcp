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
  addInstance,
  removeInstance,
  initDockerConfig,
  getExpandedConfigDir,
} from "../../../../src/cli/docker/docker-utils";
import { DockerConfig, GitLabInstance } from "../../../../src/cli/docker/types";
import * as fs from "fs";
import * as childProcess from "child_process";
import YAML from "yaml";
import { homedir } from "os";
import { join } from "path";

// Mock modules
jest.mock("fs");
jest.mock("child_process");

const mockFs = fs as jest.Mocked<typeof fs>;
const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;

describe("docker-utils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("expandPath", () => {
    it("should expand home directory (~)", () => {
      const result = expandPath("~/test/path");
      expect(result).toBe(join(homedir(), "test/path"));
    });

    it("should not modify absolute paths", () => {
      const result = expandPath("/absolute/path");
      expect(result).toBe("/absolute/path");
    });

    it("should not modify relative paths without ~", () => {
      const result = expandPath("relative/path");
      expect(result).toBe("relative/path");
    });
  });

  describe("getExpandedConfigDir", () => {
    it("should return expanded config directory path", () => {
      const result = getExpandedConfigDir();
      expect(result).toContain(homedir());
      expect(result).toContain("gitlab-mcp");
    });
  });

  describe("isDockerInstalled", () => {
    it("should return true when docker is installed", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "Docker version 24.0.0",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = isDockerInstalled();

      expect(result).toBe(true);
      expect(mockChildProcess.spawnSync).toHaveBeenCalledWith("docker", ["--version"], {
        stdio: "pipe",
        encoding: "utf8",
      });
    });

    it("should return false when docker is not installed", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "command not found",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = isDockerInstalled();

      expect(result).toBe(false);
    });

    it("should return false when spawnSync throws an error", () => {
      mockChildProcess.spawnSync.mockImplementation(() => {
        throw new Error("spawn error");
      });

      const result = isDockerInstalled();

      expect(result).toBe(false);
    });
  });

  describe("isDockerRunning", () => {
    it("should return true when docker daemon is running", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = isDockerRunning();

      expect(result).toBe(true);
      expect(mockChildProcess.spawnSync).toHaveBeenCalledWith("docker", ["info"], {
        stdio: "pipe",
        encoding: "utf8",
      });
    });

    it("should return false when docker daemon is not running", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Cannot connect to Docker daemon",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = isDockerRunning();

      expect(result).toBe(false);
    });

    it("should return false when spawnSync throws an error", () => {
      mockChildProcess.spawnSync.mockImplementation(() => {
        throw new Error("spawn error");
      });

      const result = isDockerRunning();

      expect(result).toBe(false);
    });
  });

  describe("isComposeInstalled", () => {
    it("should return true when docker compose is installed", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "Docker Compose version v2.0.0",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = isComposeInstalled();

      expect(result).toBe(true);
      expect(mockChildProcess.spawnSync).toHaveBeenCalledWith("docker", ["compose", "version"], {
        stdio: "pipe",
        encoding: "utf8",
      });
    });

    it("should return false when docker compose is not installed", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "docker compose is not a docker command",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = isComposeInstalled();

      expect(result).toBe(false);
    });

    it("should fall back to docker-compose v1 when v2 fails", () => {
      // First call (docker compose) fails
      mockChildProcess.spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "is not a docker command",
        pid: 123,
        output: [],
        signal: null,
      });
      // Second call (docker-compose) succeeds
      mockChildProcess.spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: "docker-compose version 1.29.0",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = isComposeInstalled();

      expect(result).toBe(true);
      expect(mockChildProcess.spawnSync).toHaveBeenCalledTimes(2);
    });

    it("should return false when both v1 and v2 throw errors", () => {
      mockChildProcess.spawnSync.mockImplementation(() => {
        throw new Error("spawn error");
      });

      const result = isComposeInstalled();

      expect(result).toBe(false);
    });
  });

  describe("getContainerInfo", () => {
    it("should return container info when container exists", () => {
      // Format: {{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout:
          "abc123|gitlab-mcp|gitlab-mcp:latest|Up 2 hours|0.0.0.0:3333->3333/tcp|2024-01-01 00:00:00",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result).toBeDefined();
      expect(result?.name).toBe("gitlab-mcp");
      expect(result?.status).toBe("running");
    });

    it("should return undefined when container does not exist", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result).toBeUndefined();
    });

    it("should return undefined on error", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "error",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result).toBeUndefined();
    });

    it("should return undefined for invalid container name", () => {
      const result = getContainerInfo("invalid;name");

      expect(result).toBeUndefined();
    });

    it("should return undefined when output has less than 6 parts", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "abc123|gitlab-mcp|gitlab-mcp:latest",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result).toBeUndefined();
    });

    it("should parse paused status", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "abc123|gitlab-mcp|gitlab-mcp:latest|Paused 2 hours|ports|2024-01-01",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result?.status).toBe("paused");
    });

    it("should parse restarting status", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "abc123|gitlab-mcp|gitlab-mcp:latest|Restarting (1)|ports|2024-01-01",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result?.status).toBe("restarting");
    });

    it("should parse created status", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "abc123|gitlab-mcp|gitlab-mcp:latest|Created 2 hours|ports|2024-01-01",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result?.status).toBe("created");
    });

    it("should parse dead status", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "abc123|gitlab-mcp|gitlab-mcp:latest|Dead|ports|2024-01-01",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getContainerInfo();

      expect(result?.status).toBe("dead");
    });
  });

  describe("getDockerStatus", () => {
    it("should return full status with all checks", () => {
      // Mock all checks to pass
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (args?.[0] === "--version") {
          return {
            status: 0,
            stdout: "Docker version",
            stderr: "",
            pid: 123,
            output: [],
            signal: null,
          };
        }
        if (args?.[0] === "info") {
          return {
            status: 0,
            stdout: "",
            stderr: "",
            pid: 123,
            output: [],
            signal: null,
          };
        }
        if (args?.[0] === "compose") {
          return {
            status: 0,
            stdout: "Docker Compose version",
            stderr: "",
            pid: 123,
            output: [],
            signal: null,
          };
        }
        if (args?.[0] === "ps") {
          return {
            status: 0,
            stdout: Buffer.from("[]"),
            stderr: Buffer.from(""),
            pid: 123,
            output: [],
            signal: null,
          };
        }
        return {
          status: 0,
          stdout: "",
          stderr: "",
          pid: 123,
          output: [],
          signal: null,
        };
      });

      mockFs.existsSync.mockReturnValue(false);

      const result = getDockerStatus();

      expect(result.dockerInstalled).toBe(true);
      expect(result.dockerRunning).toBe(true);
      expect(result.composeInstalled).toBe(true);
    });
  });

  describe("startContainer", () => {
    it("should start container successfully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "Container started",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = startContainer();

      expect(result.success).toBe(true);
    });

    it("should return error if config not found", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = startContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("stopContainer", () => {
    it("should stop container successfully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "Container stopped",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = stopContainer();

      expect(result.success).toBe(true);
    });
  });

  describe("restartContainer", () => {
    it("should restart container successfully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "Container restarted",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = restartContainer();

      expect(result.success).toBe(true);
    });
  });

  describe("upgradeContainer", () => {
    it("should upgrade container successfully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "Pulled latest",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = upgradeContainer();

      expect(result.success).toBe(true);
    });

    it("should return error if pull fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Failed to pull image",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = upgradeContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to pull image");
    });
  });

  describe("getLogs", () => {
    it("should get logs successfully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "Log output here",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = getLogs(100);

      expect(result.success).toBe(true);
      expect(result.output).toBe("Log output here");
    });
  });

  describe("generateDockerCompose", () => {
    it("should generate valid docker-compose YAML", () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: false,
        instances: [],
        containerName: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.version).toBe("3.8");
      expect(parsed.services["gitlab-mcp"]).toBeDefined();
      expect(parsed.services["gitlab-mcp"].image).toBe(config.image);
      expect(parsed.services["gitlab-mcp"].container_name).toBe(config.containerName);
    });

    it("should include port mapping", () => {
      const config: DockerConfig = {
        port: 4444,
        oauthEnabled: false,
        instances: [],
        containerName: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services["gitlab-mcp"].ports[0]).toContain("4444");
    });

    it("should include OAuth configuration when enabled", () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: true,
        oauthSessionSecret: "test-secret",
        instances: [],
        containerName: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services["gitlab-mcp"].environment).toContain("OAUTH_ENABLED=true");
      expect(parsed.services["gitlab-mcp"].environment).toContain(
        "OAUTH_SESSION_SECRET=${OAUTH_SESSION_SECRET}"
      );
    });

    it("should include volume for data", () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: false,
        instances: [],
        containerName: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services["gitlab-mcp"].volumes).toContain("gitlab-mcp-data:/data");
      expect(parsed.volumes["gitlab-mcp-data"]).toBeDefined();
    });

    it("should include instances volume when OAuth enabled", () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: true,
        instances: [],
        containerName: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services["gitlab-mcp"].volumes).toContain(
        "./instances.yml:/app/config/instances.yml:ro"
      );
    });

    it("should set restart policy to unless-stopped", () => {
      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: false,
        instances: [],
        containerName: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
      };

      const result = generateDockerCompose(config);
      const parsed = YAML.parse(result);

      expect(parsed.services["gitlab-mcp"].restart).toBe("unless-stopped");
    });
  });

  describe("generateInstancesYaml", () => {
    it("should generate empty instances YAML for empty array", () => {
      const result = generateInstancesYaml([]);
      const parsed = YAML.parse(result);

      expect(parsed.instances).toEqual({});
    });

    it("should generate instances YAML with basic info", () => {
      const instances: GitLabInstance[] = [
        {
          host: "gitlab.com",
          name: "GitLab.com",
        },
      ];

      const result = generateInstancesYaml(instances);
      const parsed = YAML.parse(result);

      expect(parsed.instances["gitlab.com"]).toBeDefined();
      expect(parsed.instances["gitlab.com"].name).toBe("GitLab.com");
    });

    it("should include OAuth configuration", () => {
      const instances: GitLabInstance[] = [
        {
          host: "gitlab.company.com",
          name: "Company GitLab",
          oauth: {
            clientId: "abc123",
            clientSecretEnv: "GITLAB_COMPANY_SECRET",
          },
        },
      ];

      const result = generateInstancesYaml(instances);
      const parsed = YAML.parse(result);

      expect(parsed.instances["gitlab.company.com"].oauth).toBeDefined();
      expect(parsed.instances["gitlab.company.com"].oauth.client_id).toBe("abc123");
      expect(parsed.instances["gitlab.company.com"].oauth.client_secret_env).toBe(
        "GITLAB_COMPANY_SECRET"
      );
    });

    it("should include default preset", () => {
      const instances: GitLabInstance[] = [
        {
          host: "gitlab.com",
          name: "GitLab.com",
          defaultPreset: "developer",
        },
      ];

      const result = generateInstancesYaml(instances);
      const parsed = YAML.parse(result);

      expect(parsed.instances["gitlab.com"].default_preset).toBe("developer");
    });

    it("should handle multiple instances", () => {
      const instances: GitLabInstance[] = [
        { host: "gitlab.com", name: "GitLab.com" },
        { host: "gitlab.company.com", name: "Company" },
      ];

      const result = generateInstancesYaml(instances);
      const parsed = YAML.parse(result);

      expect(Object.keys(parsed.instances)).toHaveLength(2);
    });
  });

  describe("loadInstances", () => {
    it("should return empty array if file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = loadInstances();

      expect(result).toEqual([]);
    });

    it("should parse instances from YAML file", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            "gitlab.com": {
              name: "GitLab.com",
            },
          },
        })
      );

      const result = loadInstances();

      expect(result).toHaveLength(1);
      expect(result[0].host).toBe("gitlab.com");
      expect(result[0].name).toBe("GitLab.com");
    });

    it("should parse OAuth configuration", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            "gitlab.company.com": {
              name: "Company",
              oauth: {
                client_id: "abc123",
                client_secret_env: "SECRET_VAR",
              },
            },
          },
        })
      );

      const result = loadInstances();

      expect(result[0].oauth).toBeDefined();
      expect(result[0].oauth?.clientId).toBe("abc123");
      expect(result[0].oauth?.clientSecretEnv).toBe("SECRET_VAR");
    });

    it("should return empty array on parse error", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("invalid: yaml: content:");

      const result = loadInstances();

      expect(result).toEqual([]);
    });
  });

  describe("saveInstances", () => {
    it("should create config directory if not exists", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      saveInstances([{ host: "gitlab.com", name: "GitLab" }]);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it("should write YAML to file", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const instances: GitLabInstance[] = [{ host: "gitlab.com", name: "GitLab" }];

      saveInstances(instances);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      expect(writeCall[0]).toContain("instances.yml");
    });
  });

  describe("addInstance", () => {
    it("should add new instance to empty list", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const instance: GitLabInstance = { host: "gitlab.com", name: "GitLab" };
      addInstance(instance);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("should add instance to existing list", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            "gitlab.com": { name: "GitLab" },
          },
        })
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const instance: GitLabInstance = { host: "gitlab.company.com", name: "Company" };
      addInstance(instance);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("should update existing instance with same host", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            "gitlab.com": { name: "GitLab" },
          },
        })
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const updatedInstance: GitLabInstance = { host: "gitlab.com", name: "Updated GitLab" };
      addInstance(updatedInstance);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const content = writeCall[1] as string;
      expect(content).toContain("Updated GitLab");
    });
  });

  describe("removeInstance", () => {
    it("should return false when instance not found", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = removeInstance("unknown.com");

      expect(result).toBe(false);
    });

    it("should remove instance and return true", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        YAML.stringify({
          instances: {
            "gitlab.com": { name: "GitLab" },
          },
        })
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const result = removeInstance("gitlab.com");

      expect(result).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe("initDockerConfig", () => {
    it("should create config files", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: false,
        instances: [],
        containerName: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
      };

      initDockerConfig(config);

      expect(mockFs.mkdirSync).toHaveBeenCalled();
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("should save instances when provided", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const config: DockerConfig = {
        port: 3333,
        oauthEnabled: true,
        instances: [{ host: "gitlab.com", name: "GitLab" }],
        containerName: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
      };

      initDockerConfig(config);

      // Should write both docker-compose.yml and instances.yml
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("runComposeCommand - error paths", () => {
    it("should fall back to docker-compose v1 when v2 fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      // First call fails with "is not a docker command"
      mockChildProcess.spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "is not a docker command",
        pid: 123,
        output: [],
        signal: null,
      });
      // Second call succeeds with docker-compose
      mockChildProcess.spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: "Success",
        stderr: "",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = startContainer();

      expect(result.success).toBe(true);
      expect(mockChildProcess.spawnSync).toHaveBeenCalledTimes(2);
    });

    it("should return error when command fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Some error occurred",
        pid: 123,
        output: [],
        signal: null,
      });

      const result = stopContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Some error occurred");
    });

    it("should handle exception in runComposeCommand", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockChildProcess.spawnSync.mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const result = restartContainer();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unexpected error");
    });
  });
});
