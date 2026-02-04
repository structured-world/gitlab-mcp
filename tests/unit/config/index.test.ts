/**
 * Tests for config module exports
 */

describe("config module", () => {
  describe("instance schema exports", () => {
    it("should export schema validators", async () => {
      const {
        InstanceOAuthConfigSchema,
        InstanceRateLimitConfigSchema,
        GitLabInstanceConfigSchema,
        InstanceDefaultsSchema,
        InstancesConfigFileSchema,
        ConnectionStatusSchema,
      } = await import("../../../src/config/index.js");

      expect(InstanceOAuthConfigSchema).toBeDefined();
      expect(InstanceRateLimitConfigSchema).toBeDefined();
      expect(GitLabInstanceConfigSchema).toBeDefined();
      expect(InstanceDefaultsSchema).toBeDefined();
      expect(InstancesConfigFileSchema).toBeDefined();
      expect(ConnectionStatusSchema).toBeDefined();
    });

    it("should export helper functions", async () => {
      const { parseInstanceUrlString, validateInstancesConfig, applyInstanceDefaults } =
        await import("../../../src/config/index.js");

      expect(parseInstanceUrlString).toBeDefined();
      expect(typeof parseInstanceUrlString).toBe("function");
      expect(validateInstancesConfig).toBeDefined();
      expect(typeof validateInstancesConfig).toBe("function");
      expect(applyInstanceDefaults).toBeDefined();
      expect(typeof applyInstanceDefaults).toBe("function");
    });
  });

  describe("instance loader exports", () => {
    it("should export loader functions", async () => {
      const { loadInstancesConfig, getInstanceByUrl, isKnownInstance, generateSampleConfig } =
        await import("../../../src/config/index.js");

      expect(loadInstancesConfig).toBeDefined();
      expect(typeof loadInstancesConfig).toBe("function");
      expect(getInstanceByUrl).toBeDefined();
      expect(typeof getInstanceByUrl).toBe("function");
      expect(isKnownInstance).toBeDefined();
      expect(typeof isKnownInstance).toBe("function");
      expect(generateSampleConfig).toBeDefined();
      expect(typeof generateSampleConfig).toBe("function");
    });
  });
});
