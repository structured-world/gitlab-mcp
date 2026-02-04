/**
 * Unit tests for instance configuration loader
 * Tests loading GitLab instance configuration from various sources
 */

import * as fs from "fs";
import {
  loadInstancesConfig,
  getInstanceByUrl,
  isKnownInstance,
  generateSampleConfig,
} from "../../../src/config/instances-loader";

// Mock fs module
jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

// Store original env
const originalEnv = process.env;

describe("Instance Configuration Loader", () => {
  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
    delete process.env.GITLAB_INSTANCES_FILE;
    delete process.env.GITLAB_INSTANCES;
    delete process.env.GITLAB_API_URL;
    delete process.env.SKIP_TLS_VERIFY;
    delete process.env.HOME;

    // Reset mocks
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("loadInstancesConfig", () => {
    describe("Priority 1: Configuration file (GITLAB_INSTANCES_FILE)", () => {
      it("should load JSON configuration file", async () => {
        process.env.GITLAB_INSTANCES_FILE = "/etc/gitlab-mcp/instances.json";

        const jsonConfig = JSON.stringify({
          instances: [
            { url: "https://gitlab.com", label: "GitLab.com" },
            { url: "https://git.corp.io", label: "Corporate" },
          ],
        });

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(jsonConfig);

        const result = await loadInstancesConfig();

        expect(result.source).toBe("file");
        expect(result.sourceDetails).toBe("/etc/gitlab-mcp/instances.json");
        expect(result.instances).toHaveLength(2);
        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[1].url).toBe("https://git.corp.io");
      });

      it("should expand ~ in file path", async () => {
        process.env.GITLAB_INSTANCES_FILE = "~/.config/gitlab-mcp/instances.json";
        process.env.HOME = "/home/user";

        const jsonConfig = JSON.stringify({
          instances: [{ url: "https://gitlab.com" }],
        });

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(jsonConfig);

        await loadInstancesConfig();

        expect(mockFs.existsSync).toHaveBeenCalledWith(
          "/home/user/.config/gitlab-mcp/instances.json"
        );
      });

      it("should apply defaults to instances", async () => {
        process.env.GITLAB_INSTANCES_FILE = "/config/instances.json";

        const jsonConfig = JSON.stringify({
          instances: [{ url: "https://gitlab.com" }],
          defaults: {
            rateLimit: {
              maxConcurrent: 50,
              queueSize: 200,
              queueTimeout: 30000,
            },
          },
        });

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(jsonConfig);

        const result = await loadInstancesConfig();

        expect(result.instances[0].rateLimit?.maxConcurrent).toBe(50);
        expect(result.instances[0].rateLimit?.queueSize).toBe(200);
      });

      it("should throw error when file not found", async () => {
        process.env.GITLAB_INSTANCES_FILE = "/nonexistent/file.json";
        mockFs.existsSync.mockReturnValue(false);

        await expect(loadInstancesConfig()).rejects.toThrow(/Configuration file not found/);
      });

      it("should detect JSON format from content when extension missing", async () => {
        process.env.GITLAB_INSTANCES_FILE = "/config/instances";

        const jsonConfig = JSON.stringify({
          instances: [{ url: "https://gitlab.com" }],
        });

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(jsonConfig);

        const result = await loadInstancesConfig();

        expect(result.instances[0].url).toBe("https://gitlab.com");
      });

      it("should load YAML configuration file (.yaml extension)", async () => {
        // Tests YAML file loading via dynamic import
        process.env.GITLAB_INSTANCES_FILE = "/config/instances.yaml";

        const yamlContent = `
instances:
  - url: https://gitlab.com
    label: GitLab.com
  - url: https://git.corp.io
    label: Corporate
`;

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(yamlContent);

        const result = await loadInstancesConfig();

        expect(result.source).toBe("file");
        expect(result.instances).toHaveLength(2);
        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[0].label).toBe("GitLab.com");
        expect(result.instances[1].url).toBe("https://git.corp.io");
      });

      it("should load YAML configuration file (.yml extension)", async () => {
        // Tests YAML file loading with .yml extension
        process.env.GITLAB_INSTANCES_FILE = "/config/instances.yml";

        const yamlContent = `
instances:
  - url: https://gitlab.com
`;

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(yamlContent);

        const result = await loadInstancesConfig();

        expect(result.instances[0].url).toBe("https://gitlab.com");
      });

      it("should detect YAML format from content when extension missing", async () => {
        // Tests YAML detection for files without extension (content doesn't start with {)
        process.env.GITLAB_INSTANCES_FILE = "/config/instances";

        const yamlContent = `
instances:
  - url: https://gitlab.com
    label: From YAML
`;

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(yamlContent);

        const result = await loadInstancesConfig();

        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[0].label).toBe("From YAML");
      });
    });

    describe("Priority 2: Environment variable (GITLAB_INSTANCES)", () => {
      it("should parse single URL", async () => {
        process.env.GITLAB_INSTANCES = "https://gitlab.com";

        const result = await loadInstancesConfig();

        expect(result.source).toBe("env");
        expect(result.sourceDetails).toBe("GITLAB_INSTANCES");
        expect(result.instances).toHaveLength(1);
        expect(result.instances[0].url).toBe("https://gitlab.com");
      });

      it("should parse JSON array format", async () => {
        process.env.GITLAB_INSTANCES = '["https://gitlab.com", "https://git.corp.io"]';

        const result = await loadInstancesConfig();

        expect(result.instances).toHaveLength(2);
        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[1].url).toBe("https://git.corp.io");
      });

      it("should parse JSON object format", async () => {
        process.env.GITLAB_INSTANCES = JSON.stringify({
          instances: [
            { url: "https://gitlab.com", label: "GitLab.com" },
            { url: "https://git.corp.io", label: "Corporate" },
          ],
        });

        const result = await loadInstancesConfig();

        expect(result.instances).toHaveLength(2);
        expect(result.instances[0].label).toBe("GitLab.com");
        expect(result.instances[1].label).toBe("Corporate");
      });

      it("should parse bash array format", async () => {
        process.env.GITLAB_INSTANCES =
          "(https://gitlab.com https://git.corp.io https://gl.dev.net)";

        const result = await loadInstancesConfig();

        expect(result.instances).toHaveLength(3);
        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[1].url).toBe("https://git.corp.io");
        expect(result.instances[2].url).toBe("https://gl.dev.net");
      });

      it("should parse bash array with quoted strings", async () => {
        process.env.GITLAB_INSTANCES =
          '("https://gitlab.com:app_123" "https://git.corp.io:app_456:secret")';

        const result = await loadInstancesConfig();

        expect(result.instances).toHaveLength(2);
        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[0].oauth?.clientId).toBe("app_123");
        expect(result.instances[1].url).toBe("https://git.corp.io");
        expect(result.instances[1].oauth?.clientId).toBe("app_456");
        expect(result.instances[1].oauth?.clientSecret).toBe("secret");
      });

      it("should throw on invalid JSON in GITLAB_INSTANCES", async () => {
        process.env.GITLAB_INSTANCES = "{invalid json}";

        await expect(loadInstancesConfig()).rejects.toThrow();
      });

      it("should parse space-separated URLs", async () => {
        // Tests parsing of multiple URLs separated by whitespace (not bash array syntax)
        process.env.GITLAB_INSTANCES =
          "https://gitlab.com https://git.corp.io   https://gl.dev.net";

        const result = await loadInstancesConfig();

        expect(result.instances).toHaveLength(3);
        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[1].url).toBe("https://git.corp.io");
        expect(result.instances[2].url).toBe("https://gl.dev.net");
      });

      it("should parse space-separated URLs with OAuth credentials", async () => {
        // Tests space-separated format with inline OAuth config
        process.env.GITLAB_INSTANCES =
          "https://gitlab.com:app_123 https://git.corp.io:app_456:secret";

        const result = await loadInstancesConfig();

        expect(result.instances).toHaveLength(2);
        expect(result.instances[0].oauth?.clientId).toBe("app_123");
        expect(result.instances[1].oauth?.clientId).toBe("app_456");
        expect(result.instances[1].oauth?.clientSecret).toBe("secret");
      });
    });

    describe("Priority 3: Legacy single-instance (GITLAB_API_URL)", () => {
      it("should use GITLAB_API_URL as legacy fallback", async () => {
        process.env.GITLAB_API_URL = "https://gitlab.com";

        const result = await loadInstancesConfig();

        expect(result.source).toBe("legacy");
        expect(result.sourceDetails).toBe("GITLAB_API_URL");
        expect(result.instances).toHaveLength(1);
        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[0].label).toBe("Default Instance");
      });

      it("should normalize URL removing trailing slash", async () => {
        process.env.GITLAB_API_URL = "https://gitlab.com/";

        const result = await loadInstancesConfig();

        expect(result.instances[0].url).toBe("https://gitlab.com");
      });

      it("should normalize URL removing /api/v4 suffix", async () => {
        process.env.GITLAB_API_URL = "https://gitlab.com/api/v4";

        const result = await loadInstancesConfig();

        expect(result.instances[0].url).toBe("https://gitlab.com");
      });

      it("should respect SKIP_TLS_VERIFY setting", async () => {
        process.env.GITLAB_API_URL = "https://gitlab.local";
        process.env.SKIP_TLS_VERIFY = "true";

        const result = await loadInstancesConfig();

        expect(result.instances[0].insecureSkipVerify).toBe(true);
      });
    });

    describe("Priority 4: Default (no configuration)", () => {
      it("should return gitlab.com as default when no config", async () => {
        const result = await loadInstancesConfig();

        expect(result.source).toBe("none");
        expect(result.sourceDetails).toBe("default");
        expect(result.instances).toHaveLength(1);
        expect(result.instances[0].url).toBe("https://gitlab.com");
        expect(result.instances[0].label).toBe("GitLab.com");
      });
    });

    describe("Configuration priority", () => {
      it("should prefer GITLAB_INSTANCES_FILE over GITLAB_INSTANCES", async () => {
        process.env.GITLAB_INSTANCES_FILE = "/config/instances.json";
        process.env.GITLAB_INSTANCES = "https://other.gitlab.com";

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(
          JSON.stringify({
            instances: [{ url: "https://from-file.gitlab.com" }],
          })
        );

        const result = await loadInstancesConfig();

        expect(result.source).toBe("file");
        expect(result.instances[0].url).toBe("https://from-file.gitlab.com");
      });

      it("should prefer GITLAB_INSTANCES over GITLAB_API_URL", async () => {
        process.env.GITLAB_INSTANCES = "https://from-env.gitlab.com";
        process.env.GITLAB_API_URL = "https://legacy.gitlab.com";

        const result = await loadInstancesConfig();

        expect(result.source).toBe("env");
        expect(result.instances[0].url).toBe("https://from-env.gitlab.com");
      });
    });
  });

  describe("getInstanceByUrl", () => {
    const instances = [
      { url: "https://gitlab.com", label: "GitLab.com", insecureSkipVerify: false },
      { url: "https://git.corp.io", label: "Corporate", insecureSkipVerify: false },
    ];

    it("should find instance by exact URL", () => {
      const result = getInstanceByUrl(instances, "https://gitlab.com");
      expect(result?.label).toBe("GitLab.com");
    });

    it("should find instance with trailing slash in search URL", () => {
      const result = getInstanceByUrl(instances, "https://gitlab.com/");
      expect(result?.label).toBe("GitLab.com");
    });

    it("should find instance with /api/v4 suffix in search URL", () => {
      const result = getInstanceByUrl(instances, "https://gitlab.com/api/v4");
      expect(result?.label).toBe("GitLab.com");
    });

    it("should return undefined for unknown URL", () => {
      const result = getInstanceByUrl(instances, "https://unknown.gitlab.com");
      expect(result).toBeUndefined();
    });
  });

  describe("isKnownInstance", () => {
    const instances = [
      { url: "https://gitlab.com", insecureSkipVerify: false },
      { url: "https://git.corp.io", insecureSkipVerify: false },
    ];

    it("should return true for known instance", () => {
      expect(isKnownInstance(instances, "https://gitlab.com")).toBe(true);
      expect(isKnownInstance(instances, "https://git.corp.io")).toBe(true);
    });

    it("should return false for unknown instance", () => {
      expect(isKnownInstance(instances, "https://unknown.gitlab.com")).toBe(false);
    });
  });

  describe("generateSampleConfig", () => {
    it("should generate valid JSON config", () => {
      const config = generateSampleConfig("json");
      const parsed = JSON.parse(config);

      expect(parsed.instances).toBeInstanceOf(Array);
      expect(parsed.instances.length).toBeGreaterThan(0);
      expect(parsed.defaults).toBeDefined();
    });

    it("should generate YAML-formatted config", () => {
      const config = generateSampleConfig("yaml");

      expect(config).toContain("instances:");
      expect(config).toContain("url:");
      expect(config).toContain("defaults:");
      expect(config).toContain("GitLab MCP Instances Configuration");
    });
  });
});
