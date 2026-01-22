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
} from "../../../../src/cli/docker/docker-utils";
import { DockerConfig, GitLabInstance } from "../../../../src/cli/docker/types";
import * as fs from "fs";
import YAML from "yaml";
import { homedir } from "os";
import { join } from "path";

// Mock modules
jest.mock("fs");
jest.mock("child_process");

const mockFs = fs as jest.Mocked<typeof fs>;

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
});
