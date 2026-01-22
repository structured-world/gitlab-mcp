/**
 * Unit tests for docker/types.ts
 * Tests type definitions and constants
 */

import {
  DEFAULT_DOCKER_CONFIG,
  CONFIG_PATHS,
  getConfigDir,
} from "../../../../src/cli/docker/types";

describe("docker types", () => {
  describe("DEFAULT_DOCKER_CONFIG", () => {
    it("should have default port 3333", () => {
      expect(DEFAULT_DOCKER_CONFIG.port).toBe(3333);
    });

    it("should have OAuth disabled by default", () => {
      expect(DEFAULT_DOCKER_CONFIG.oauthEnabled).toBe(false);
    });

    it("should have empty instances array by default", () => {
      expect(DEFAULT_DOCKER_CONFIG.instances).toEqual([]);
    });

    it("should have default container name", () => {
      expect(DEFAULT_DOCKER_CONFIG.containerName).toBe("gitlab-mcp");
    });

    it("should have default image", () => {
      expect(DEFAULT_DOCKER_CONFIG.image).toBe("ghcr.io/structured-world/gitlab-mcp:latest");
    });
  });

  describe("CONFIG_PATHS", () => {
    it("should have path for darwin", () => {
      expect(CONFIG_PATHS.darwin).toBe("~/.config/gitlab-mcp");
    });

    it("should have path for win32", () => {
      expect(CONFIG_PATHS.win32).toBe("%APPDATA%/gitlab-mcp");
    });

    it("should have path for linux", () => {
      expect(CONFIG_PATHS.linux).toBe("~/.config/gitlab-mcp");
    });
  });

  describe("getConfigDir", () => {
    it("should return config path for current platform", () => {
      const result = getConfigDir();
      const platform = process.platform as "darwin" | "win32" | "linux";
      const expected = CONFIG_PATHS[platform] ?? CONFIG_PATHS.linux;
      expect(result).toBe(expected);
    });
  });
});
