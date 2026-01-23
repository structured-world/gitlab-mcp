/**
 * Unit tests for setup wizard discovery module
 */

import { DiscoveryResult } from "../../../../src/cli/setup/types";
import { formatDiscoverySummary } from "../../../../src/cli/setup/discovery";

// Mock child_process to prevent actual system calls
jest.mock("child_process", () => ({
  spawnSync: jest.fn().mockReturnValue({ status: 1, stdout: "", stderr: "" }),
}));

// Mock detector to control client detection results
jest.mock("../../../../src/cli/install/detector", () => ({
  detectAllClients: jest.fn().mockReturnValue([]),
}));

import { spawnSync } from "child_process";
import { detectAllClients } from "../../../../src/cli/install/detector";

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockDetectAllClients = detectAllClients as jest.MockedFunction<typeof detectAllClients>;

describe("setup/discovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    });
  });

  describe("runDiscovery", () => {
    it("should return empty discovery when no clients or docker detected", async () => {
      mockDetectAllClients.mockReturnValue([]);

      // Re-import to use mocked dependencies
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

    it("should detect Docker environment when Docker is installed", async () => {
      mockDetectAllClients.mockReturnValue([]);

      // Mock Docker commands to succeed
      mockSpawnSync.mockImplementation((command, args) => {
        const cmd = `${command} ${(args as string[]).join(" ")}`;
        if (cmd.includes("--version")) {
          return {
            status: 0,
            stdout: "Docker version 24.0.0",
            stderr: "",
            pid: 0,
            output: [],
            signal: null,
          };
        }
        if (cmd.includes("info")) {
          return { status: 0, stdout: "running", stderr: "", pid: 0, output: [], signal: null };
        }
        if (cmd.includes("compose version")) {
          return { status: 0, stdout: "v2.20.0", stderr: "", pid: 0, output: [], signal: null };
        }
        if (cmd.includes("ps")) {
          return { status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null };
        }
        return { status: 1, stdout: "", stderr: "", pid: 0, output: [], signal: null };
      });

      const { runDiscovery } = await import("../../../../src/cli/setup/discovery");
      const result = runDiscovery();

      expect(result.docker.dockerInstalled).toBe(true);
      expect(result.docker.dockerRunning).toBe(true);
      expect(result.docker.composeInstalled).toBe(true);
    });

    it("should detect docker-compose v1 when v2 is not available", async () => {
      mockDetectAllClients.mockReturnValue([]);

      mockSpawnSync.mockImplementation((command, args) => {
        const cmd = `${command} ${(args as string[]).join(" ")}`;
        if (cmd.includes("--version") && !cmd.includes("compose")) {
          return {
            status: 0,
            stdout: "Docker version 24.0.0",
            stderr: "",
            pid: 0,
            output: [],
            signal: null,
          };
        }
        if (cmd.includes("info")) {
          return { status: 0, stdout: "running", stderr: "", pid: 0, output: [], signal: null };
        }
        if (cmd.includes("compose version")) {
          return { status: 1, stdout: "", stderr: "not found", pid: 0, output: [], signal: null };
        }
        if (command === "docker-compose") {
          return {
            status: 0,
            stdout: "docker-compose version 1.29.2",
            stderr: "",
            pid: 0,
            output: [],
            signal: null,
          };
        }
        if (cmd.includes("ps")) {
          return { status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null };
        }
        return { status: 1, stdout: "", stderr: "", pid: 0, output: [], signal: null };
      });

      const { runDiscovery } = await import("../../../../src/cli/setup/discovery");
      const result = runDiscovery();

      expect(result.docker.composeInstalled).toBe(true);
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

    it("should show Docker installed without container", () => {
      const result: DiscoveryResult = {
        clients: { detected: [], configured: [], unconfigured: [] },
        docker: {
          dockerInstalled: true,
          dockerRunning: true,
          composeInstalled: true,
          instances: [],
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
