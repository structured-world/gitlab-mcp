/**
 * Unit tests for docker/index.ts
 * Tests module exports
 */

import * as dockerModule from "../../../../src/cli/docker";

describe("docker module exports", () => {
  describe("types exports", () => {
    it("should export DEFAULT_DOCKER_CONFIG", () => {
      expect(dockerModule.DEFAULT_DOCKER_CONFIG).toBeDefined();
    });

    it("should export CONFIG_PATHS", () => {
      expect(dockerModule.CONFIG_PATHS).toBeDefined();
    });

    it("should export getConfigDir", () => {
      expect(dockerModule.getConfigDir).toBeDefined();
      expect(typeof dockerModule.getConfigDir).toBe("function");
    });
  });

  describe("docker-utils exports", () => {
    it("should export expandPath", () => {
      expect(dockerModule.expandPath).toBeDefined();
      expect(typeof dockerModule.expandPath).toBe("function");
    });

    it("should export getExpandedConfigDir", () => {
      expect(dockerModule.getExpandedConfigDir).toBeDefined();
      expect(typeof dockerModule.getExpandedConfigDir).toBe("function");
    });

    it("should export isDockerInstalled", () => {
      expect(dockerModule.isDockerInstalled).toBeDefined();
      expect(typeof dockerModule.isDockerInstalled).toBe("function");
    });

    it("should export isDockerRunning", () => {
      expect(dockerModule.isDockerRunning).toBeDefined();
      expect(typeof dockerModule.isDockerRunning).toBe("function");
    });

    it("should export isComposeInstalled", () => {
      expect(dockerModule.isComposeInstalled).toBeDefined();
      expect(typeof dockerModule.isComposeInstalled).toBe("function");
    });

    it("should export getContainerInfo", () => {
      expect(dockerModule.getContainerInfo).toBeDefined();
      expect(typeof dockerModule.getContainerInfo).toBe("function");
    });

    it("should export getDockerStatus", () => {
      expect(dockerModule.getDockerStatus).toBeDefined();
      expect(typeof dockerModule.getDockerStatus).toBe("function");
    });

    it("should export generateDockerCompose", () => {
      expect(dockerModule.generateDockerCompose).toBeDefined();
      expect(typeof dockerModule.generateDockerCompose).toBe("function");
    });

    it("should export generateInstancesYaml", () => {
      expect(dockerModule.generateInstancesYaml).toBeDefined();
      expect(typeof dockerModule.generateInstancesYaml).toBe("function");
    });

    it("should export loadInstances", () => {
      expect(dockerModule.loadInstances).toBeDefined();
      expect(typeof dockerModule.loadInstances).toBe("function");
    });

    it("should export saveInstances", () => {
      expect(dockerModule.saveInstances).toBeDefined();
      expect(typeof dockerModule.saveInstances).toBe("function");
    });

    it("should export container management functions", () => {
      expect(dockerModule.startContainer).toBeDefined();
      expect(dockerModule.stopContainer).toBeDefined();
      expect(dockerModule.restartContainer).toBeDefined();
      expect(dockerModule.upgradeContainer).toBeDefined();
    });

    it("should export log functions", () => {
      expect(dockerModule.getLogs).toBeDefined();
      expect(dockerModule.tailLogs).toBeDefined();
    });

    it("should export instance management functions", () => {
      expect(dockerModule.addInstance).toBeDefined();
      expect(dockerModule.removeInstance).toBeDefined();
    });

    it("should export initDockerConfig", () => {
      expect(dockerModule.initDockerConfig).toBeDefined();
      expect(typeof dockerModule.initDockerConfig).toBe("function");
    });
  });

  describe("docker-command exports", () => {
    it("should export runDockerCommand", () => {
      expect(dockerModule.runDockerCommand).toBeDefined();
      expect(typeof dockerModule.runDockerCommand).toBe("function");
    });

    it("should export parseDockerSubcommand", () => {
      expect(dockerModule.parseDockerSubcommand).toBeDefined();
      expect(typeof dockerModule.parseDockerSubcommand).toBe("function");
    });
  });
});
