/**
 * Unit tests for instance configuration schemas
 * Tests Zod schemas and helper functions for multi-instance configuration
 */

import {
  GitLabInstanceConfigSchema,
  InstancesConfigFileSchema,
  parseInstanceUrlString,
  validateInstancesConfig,
  applyInstanceDefaults,
  GitLabInstanceConfig,
  InstanceDefaults,
} from "../../../src/config/instances-schema";

describe("Instance Configuration Schemas", () => {
  describe("GitLabInstanceConfigSchema", () => {
    it("should validate minimal config with just URL", () => {
      const config = {
        url: "https://gitlab.com",
      };

      const result = GitLabInstanceConfigSchema.parse(config);
      expect(result.url).toBe("https://gitlab.com");
      expect(result.insecureSkipVerify).toBe(false);
    });

    it("should normalize URL by removing trailing slash", () => {
      const config = {
        url: "https://gitlab.com/",
      };

      const result = GitLabInstanceConfigSchema.parse(config);
      expect(result.url).toBe("https://gitlab.com");
    });

    it("should normalize URL by removing /api/v4 suffix", () => {
      const config = {
        url: "https://gitlab.com/api/v4",
      };

      const result = GitLabInstanceConfigSchema.parse(config);
      expect(result.url).toBe("https://gitlab.com");
    });

    it("should validate full config with all fields", () => {
      const config = {
        url: "https://git.corp.io",
        label: "Corporate GitLab",
        oauth: {
          clientId: "app_123",
          clientSecret: "secret_456",
          scopes: "api read_user write_repository",
        },
        rateLimit: {
          maxConcurrent: 50,
          queueSize: 200,
          queueTimeout: 30000,
        },
        insecureSkipVerify: true,
      };

      const result = GitLabInstanceConfigSchema.parse(config);
      expect(result.url).toBe("https://git.corp.io");
      expect(result.label).toBe("Corporate GitLab");
      expect(result.oauth?.clientId).toBe("app_123");
      expect(result.oauth?.clientSecret).toBe("secret_456");
      expect(result.oauth?.scopes).toBe("api read_user write_repository");
      expect(result.rateLimit?.maxConcurrent).toBe(50);
      expect(result.insecureSkipVerify).toBe(true);
    });

    it("should reject invalid URL", () => {
      const config = {
        url: "not-a-valid-url",
      };

      expect(() => GitLabInstanceConfigSchema.parse(config)).toThrow();
    });

    it("should use default OAuth scopes when not specified", () => {
      const config = {
        url: "https://gitlab.com",
        oauth: {
          clientId: "app_123",
        },
      };

      const result = GitLabInstanceConfigSchema.parse(config);
      expect(result.oauth?.scopes).toBe("api read_user");
    });
  });

  describe("InstancesConfigFileSchema", () => {
    it("should validate config file with single instance", () => {
      const config = {
        instances: [
          {
            url: "https://gitlab.com",
            label: "GitLab.com",
          },
        ],
      };

      const result = InstancesConfigFileSchema.parse(config);
      expect(result.instances).toHaveLength(1);
      expect(result.instances[0].url).toBe("https://gitlab.com");
    });

    it("should validate config file with multiple instances", () => {
      const config = {
        instances: [
          { url: "https://gitlab.com", label: "GitLab.com" },
          { url: "https://git.corp.io", label: "Corporate" },
          { url: "https://gl.dev.net", label: "Development" },
        ],
        defaults: {
          rateLimit: {
            maxConcurrent: 100,
            queueSize: 500,
            queueTimeout: 60000,
          },
        },
      };

      const result = InstancesConfigFileSchema.parse(config);
      expect(result.instances).toHaveLength(3);
      expect(result.defaults?.rateLimit?.maxConcurrent).toBe(100);
    });

    it("should reject empty instances array", () => {
      const config = {
        instances: [],
      };

      expect(() => InstancesConfigFileSchema.parse(config)).toThrow();
    });
  });

  describe("parseInstanceUrlString", () => {
    it("should parse simple URL", () => {
      const result = parseInstanceUrlString("https://gitlab.com");
      expect(result.url).toBe("https://gitlab.com");
      expect(result.oauth).toBeUndefined();
    });

    it("should parse URL with client ID", () => {
      const result = parseInstanceUrlString("https://gitlab.com:app_123");
      expect(result.url).toBe("https://gitlab.com");
      expect(result.oauth?.clientId).toBe("app_123");
      expect(result.oauth?.clientSecret).toBeUndefined();
    });

    it("should parse URL with client ID and secret", () => {
      const result = parseInstanceUrlString("https://gitlab.com:app_123:secret_456");
      expect(result.url).toBe("https://gitlab.com");
      expect(result.oauth?.clientId).toBe("app_123");
      expect(result.oauth?.clientSecret).toBe("secret_456");
    });

    it("should handle URL with port number", () => {
      const result = parseInstanceUrlString("https://gitlab.local:8443");
      expect(result.url).toBe("https://gitlab.local:8443");
      expect(result.oauth).toBeUndefined();
    });

    it("should handle URL with port and client ID", () => {
      const result = parseInstanceUrlString("https://gitlab.local:8443:app_123");
      expect(result.url).toBe("https://gitlab.local:8443");
      expect(result.oauth?.clientId).toBe("app_123");
    });

    it("should throw on invalid URL format", () => {
      expect(() => parseInstanceUrlString("not-a-url")).toThrow();
    });

    it("should treat number > 65535 as OAuth client ID, not port", () => {
      // Numbers larger than valid port range (1-65535) should be treated as OAuth client IDs
      const result = parseInstanceUrlString("https://gitlab.com:123456789");
      expect(result.url).toBe("https://gitlab.com");
      expect(result.oauth?.clientId).toBe("123456789");
    });

    it("should parse URL with large numeric client ID and secret", () => {
      const result = parseInstanceUrlString("https://gitlab.com:999999999:mysecret");
      expect(result.url).toBe("https://gitlab.com");
      expect(result.oauth?.clientId).toBe("999999999");
      expect(result.oauth?.clientSecret).toBe("mysecret");
    });
  });

  describe("validateInstancesConfig", () => {
    it("should validate and return config", () => {
      const config = {
        instances: [{ url: "https://gitlab.com" }],
      };

      const result = validateInstancesConfig(config);
      expect(result.instances).toHaveLength(1);
    });

    it("should throw on invalid config", () => {
      const config = {
        instances: "not-an-array",
      };

      expect(() => validateInstancesConfig(config)).toThrow();
    });
  });

  describe("applyInstanceDefaults", () => {
    it("should return instance unchanged when no defaults", () => {
      const instance: GitLabInstanceConfig = {
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      };

      const result = applyInstanceDefaults(instance);
      expect(result).toEqual(instance);
    });

    it("should apply rate limit defaults when not set on instance", () => {
      const instance: GitLabInstanceConfig = {
        url: "https://gitlab.com",
        insecureSkipVerify: false,
      };

      const defaults: InstanceDefaults = {
        rateLimit: {
          maxConcurrent: 100,
          queueSize: 500,
          queueTimeout: 60000,
        },
      };

      const result = applyInstanceDefaults(instance, defaults);
      expect(result.rateLimit?.maxConcurrent).toBe(100);
      expect(result.rateLimit?.queueSize).toBe(500);
    });

    it("should not override instance rate limit with defaults", () => {
      const instance: GitLabInstanceConfig = {
        url: "https://gitlab.com",
        rateLimit: {
          maxConcurrent: 50,
          queueSize: 200,
          queueTimeout: 30000,
        },
        insecureSkipVerify: false,
      };

      const defaults: InstanceDefaults = {
        rateLimit: {
          maxConcurrent: 100,
          queueSize: 500,
          queueTimeout: 60000,
        },
      };

      const result = applyInstanceDefaults(instance, defaults);
      expect(result.rateLimit?.maxConcurrent).toBe(50);
    });

    it("should apply OAuth scope defaults when instance has oauth but no scopes", () => {
      // Instance has oauth config but scopes will have default from schema
      // This tests the edge case where oauth.scopes might be empty string
      const instance: GitLabInstanceConfig = {
        url: "https://gitlab.com",
        oauth: {
          clientId: "app_123",
          scopes: "", // Empty scopes
        },
        insecureSkipVerify: false,
      };

      const defaults: InstanceDefaults = {
        oauth: {
          scopes: "api read_user",
        },
      };

      const result = applyInstanceDefaults(instance, defaults);
      // Empty string is falsy, so defaults should apply
      expect(result.oauth?.scopes).toBe("api read_user");
    });

    it("should not override existing OAuth scopes with defaults", () => {
      const instance: GitLabInstanceConfig = {
        url: "https://gitlab.com",
        oauth: {
          clientId: "app_123",
          scopes: "api",
        },
        insecureSkipVerify: false,
      };

      const defaults: InstanceDefaults = {
        oauth: {
          scopes: "api read_user write_repository",
        },
      };

      const result = applyInstanceDefaults(instance, defaults);
      // Existing scopes should be preserved
      expect(result.oauth?.scopes).toBe("api");
    });
  });
});
