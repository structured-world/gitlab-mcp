/**
 * Unit tests for setup wizard discovery module
 */

import { DiscoveryResult } from "../../../../src/cli/setup/types";
import { ContainerRuntimeInfo } from "../../../../src/cli/docker/types";
import { formatDiscoverySummary } from "../../../../src/cli/setup/discovery";

// Mock container-runtime module
jest.mock("../../../../src/cli/docker/container-runtime");
// Mock docker-utils getContainerInfo
jest.mock("../../../../src/cli/docker/docker-utils", () => ({
  getContainerInfo: jest.fn().mockReturnValue(undefined),
}));

// Mock detector to control client detection results
jest.mock("../../../../src/cli/install/detector", () => ({
  detectAllClients: jest.fn().mockReturnValue([]),
}));

import { getContainerRuntime } from "../../../../src/cli/docker/container-runtime";
import { getContainerInfo } from "../../../../src/cli/docker/docker-utils";
import { detectAllClients } from "../../../../src/cli/install/detector";

const mockGetContainerRuntime = getContainerRuntime as jest.MockedFunction<
  typeof getContainerRuntime
>;
const mockGetContainerInfo = getContainerInfo as jest.MockedFunction<typeof getContainerInfo>;
const mockDetectAllClients = detectAllClients as jest.MockedFunction<typeof detectAllClients>;

// Default: no runtime available
const noRuntime: ContainerRuntimeInfo = {
  runtime: "docker",
  runtimeCmd: "docker",
  runtimeAvailable: false,
  composeCmd: null,
  runtimeVersion: undefined,
};

const dockerRuntime: ContainerRuntimeInfo = {
  runtime: "docker",
  runtimeCmd: "docker",
  runtimeAvailable: true,
  composeCmd: ["docker", "compose"],
  runtimeVersion: "24.0.7",
};

const podmanRuntime: ContainerRuntimeInfo = {
  runtime: "podman",
  runtimeCmd: "podman",
  runtimeAvailable: true,
  composeCmd: ["podman", "compose"],
  runtimeVersion: "4.9.3",
};

describe("setup/discovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no runtime, no clients
    mockGetContainerRuntime.mockReturnValue(noRuntime);
    mockGetContainerInfo.mockReturnValue(undefined);
    mockDetectAllClients.mockReturnValue([]);
  });

  describe("runDiscovery", () => {
    it("should return empty discovery when no clients or runtime detected", async () => {
      const { runDiscovery } = await import("../../../../src/cli/setup/discovery");
      const result = runDiscovery();

      expect(result.clients.detected).toHaveLength(0);
      expect(result.clients.configured).toHaveLength(0);
      expect(result.clients.unconfigured).toHaveLength(0);
      expect(result.docker.dockerInstalled).toBe(false);
      expect(result.summary.hasExistingSetup).toBe(false);
    });

    it("should detect installed clients", async () => {
      mockDetectAllClients.mockReturnValue([
        {
          client: "claude-code",
          detected: true,
          method: "cli-command",
          alreadyConfigured: false,
        },
        {
          client: "cursor",
          detected: true,
          method: "config-file",
          alreadyConfigured: true,
        },
        {
          client: "windsurf",
          detected: false,
          method: "config-file",
        },
      ]);

      const { runDiscovery } = await import("../../../../src/cli/setup/discovery");
      const result = runDiscovery();

      expect(result.clients.detected).toHaveLength(2);
      expect(result.clients.configured).toHaveLength(1);
      expect(result.clients.unconfigured).toHaveLength(1);
      expect(result.summary.clientCount).toBe(2);
      expect(result.summary.configuredCount).toBe(1);
      expect(result.summary.hasExistingSetup).toBe(true);
    });

    it("should detect Docker runtime when available", async () => {
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);
      mockGetContainerInfo.mockReturnValue(undefined);

      const { runDiscovery } = await import("../../../../src/cli/setup/discovery");
      const result = runDiscovery();

      expect(result.docker.dockerInstalled).toBe(true);
      expect(result.docker.dockerRunning).toBe(true);
      expect(result.docker.composeInstalled).toBe(true);
      expect(result.docker.runtime?.runtime).toBe("docker");
    });

    it("should detect Podman runtime", async () => {
      mockGetContainerRuntime.mockReturnValue(podmanRuntime);
      mockGetContainerInfo.mockReturnValue(undefined);

      const { runDiscovery } = await import("../../../../src/cli/setup/discovery");
      const result = runDiscovery();

      expect(result.docker.dockerInstalled).toBe(true);
      expect(result.docker.dockerRunning).toBe(true);
      expect(result.docker.runtime?.runtime).toBe("podman");
    });

    it("should include container info when runtime is available", async () => {
      mockGetContainerRuntime.mockReturnValue(dockerRuntime);
      mockGetContainerInfo.mockReturnValue({
        id: "abc123",
        name: "gitlab-mcp",
        image: "ghcr.io/structured-world/gitlab-mcp:latest",
        status: "running",
        ports: ["3333:3333"],
        created: "2024-01-01",
      });

      const { runDiscovery } = await import("../../../../src/cli/setup/discovery");
      const result = runDiscovery();

      expect(result.docker.container).toBeDefined();
      expect(result.docker.container?.status).toBe("running");
      expect(result.summary.containerExists).toBe(true);
      expect(result.summary.hasExistingSetup).toBe(true);
    });

    it("should not call getContainerInfo when runtime is unavailable", async () => {
      mockGetContainerRuntime.mockReturnValue(noRuntime);

      const { runDiscovery } = await import("../../../../src/cli/setup/discovery");
      runDiscovery();

      expect(mockGetContainerInfo).not.toHaveBeenCalled();
    });
  });

  describe("formatDiscoverySummary", () => {
    it("should format empty discovery result", () => {
      const result: DiscoveryResult = {
        clients: { detected: [], configured: [], unconfigured: [] },
        docker: {
          dockerInstalled: false,
          dockerRunning: false,
          composeInstalled: false,
          instances: [],
        },
        summary: {
          hasExistingSetup: false,
          clientCount: 0,
          configuredCount: 0,
          dockerRunning: false,
          containerExists: false,
        },
      };

      const formatted = formatDiscoverySummary(result);
      expect(formatted).toContain("No MCP clients detected");
    });

    it("should show detected clients", () => {
      const result: DiscoveryResult = {
        clients: {
          detected: [
            { client: "claude-code", detected: true, method: "cli-command" },
            { client: "cursor", detected: true, method: "config-file" },
          ],
          configured: [
            { client: "cursor", detected: true, method: "config-file", alreadyConfigured: true },
          ],
          unconfigured: [{ client: "claude-code", detected: true, method: "cli-command" }],
        },
        docker: {
          dockerInstalled: false,
          dockerRunning: false,
          composeInstalled: false,
          instances: [],
        },
        summary: {
          hasExistingSetup: true,
          clientCount: 2,
          configuredCount: 1,
          dockerRunning: false,
          containerExists: false,
        },
      };

      const formatted = formatDiscoverySummary(result);
      expect(formatted).toContain("Clients:");
      expect(formatted).toContain("claude-code");
      expect(formatted).toContain("cursor ✓");
      expect(formatted).toContain("Configured: 1 client(s)");
    });

    it("should show Docker container status", () => {
      const result: DiscoveryResult = {
        clients: { detected: [], configured: [], unconfigured: [] },
        docker: {
          dockerInstalled: true,
          dockerRunning: true,
          composeInstalled: true,
          container: {
            id: "abc123",
            name: "gitlab-mcp",
            image: "ghcr.io/structured-world/gitlab-mcp:latest",
            status: "running",
            ports: ["3333:3333"],
            created: "",
          },
          instances: [],
          runtime: dockerRuntime,
        },
        summary: {
          hasExistingSetup: true,
          clientCount: 0,
          configuredCount: 0,
          dockerRunning: true,
          containerExists: true,
        },
      };

      const formatted = formatDiscoverySummary(result);
      expect(formatted).toContain("Docker: container running");
    });

    it("should show Podman label when runtime is podman", () => {
      const result: DiscoveryResult = {
        clients: { detected: [], configured: [], unconfigured: [] },
        docker: {
          dockerInstalled: true,
          dockerRunning: true,
          composeInstalled: true,
          instances: [],
          runtime: podmanRuntime,
        },
        summary: {
          hasExistingSetup: false,
          clientCount: 0,
          configuredCount: 0,
          dockerRunning: true,
          containerExists: false,
        },
      };

      const formatted = formatDiscoverySummary(result);
      expect(formatted).toContain("Podman: installed, no container");
    });

    it("should show Docker installed without container", () => {
      const result: DiscoveryResult = {
        clients: { detected: [], configured: [], unconfigured: [] },
        docker: {
          dockerInstalled: true,
          dockerRunning: true,
          composeInstalled: true,
          instances: [],
          runtime: dockerRuntime,
        },
        summary: {
          hasExistingSetup: false,
          clientCount: 0,
          configuredCount: 0,
          dockerRunning: true,
          containerExists: false,
        },
      };

      const formatted = formatDiscoverySummary(result);
      expect(formatted).toContain("Docker: installed, no container");
    });
  });
});
