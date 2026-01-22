/**
 * Unit tests for docker/docker-command.ts
 * Tests Docker command parsing and command handlers
 */

import {
  parseDockerSubcommand,
  DockerSubcommand,
  showStatus,
  dockerStart,
  dockerStop,
  dockerRestart,
  dockerUpgrade,
  dockerLogs,
  dockerRemoveInstance,
  runDockerCommand,
} from "../../../../src/cli/docker/docker-command";

// Mock docker-utils
jest.mock("../../../../src/cli/docker/docker-utils", () => ({
  getDockerStatus: jest.fn(),
  startContainer: jest.fn(),
  stopContainer: jest.fn(),
  restartContainer: jest.fn(),
  upgradeContainer: jest.fn(),
  getLogs: jest.fn(),
  tailLogs: jest.fn(),
  addInstance: jest.fn(),
  removeInstance: jest.fn(),
  initDockerConfig: jest.fn(),
  getExpandedConfigDir: jest.fn(() => "/home/user/.gitlab-mcp"),
}));

// Mock @clack/prompts
jest.mock("@clack/prompts", () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  },
  note: jest.fn(),
  spinner: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
  text: jest.fn(),
  confirm: jest.fn(),
  select: jest.fn(),
  isCancel: jest.fn(() => false),
  cancel: jest.fn(),
}));

import {
  getDockerStatus,
  startContainer,
  stopContainer,
  restartContainer,
  upgradeContainer,
  getLogs,
  tailLogs,
  removeInstance,
} from "../../../../src/cli/docker/docker-utils";

const mockGetDockerStatus = getDockerStatus as jest.Mock;
const mockStartContainer = startContainer as jest.Mock;
const mockStopContainer = stopContainer as jest.Mock;
const mockRestartContainer = restartContainer as jest.Mock;
const mockUpgradeContainer = upgradeContainer as jest.Mock;
const mockGetLogs = getLogs as jest.Mock;
const mockTailLogs = tailLogs as jest.Mock;
const mockRemoveInstance = removeInstance as jest.Mock;

describe("docker-command", () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("parseDockerSubcommand", () => {
    it("should parse status subcommand", () => {
      const result = parseDockerSubcommand(["status"]);
      expect(result.subcommand).toBe("status");
      expect(result.subArgs).toEqual([]);
    });

    it("should parse init subcommand", () => {
      const result = parseDockerSubcommand(["init"]);
      expect(result.subcommand).toBe("init");
    });

    it("should parse start subcommand", () => {
      const result = parseDockerSubcommand(["start"]);
      expect(result.subcommand).toBe("start");
    });

    it("should parse stop subcommand", () => {
      const result = parseDockerSubcommand(["stop"]);
      expect(result.subcommand).toBe("stop");
    });

    it("should parse restart subcommand", () => {
      const result = parseDockerSubcommand(["restart"]);
      expect(result.subcommand).toBe("restart");
    });

    it("should parse upgrade subcommand", () => {
      const result = parseDockerSubcommand(["upgrade"]);
      expect(result.subcommand).toBe("upgrade");
    });

    it("should parse logs subcommand", () => {
      const result = parseDockerSubcommand(["logs"]);
      expect(result.subcommand).toBe("logs");
    });

    it("should parse logs subcommand with -f flag", () => {
      const result = parseDockerSubcommand(["logs", "-f"]);
      expect(result.subcommand).toBe("logs");
      expect(result.subArgs).toEqual(["-f"]);
    });

    it("should parse logs subcommand with --follow flag", () => {
      const result = parseDockerSubcommand(["logs", "--follow"]);
      expect(result.subcommand).toBe("logs");
      expect(result.subArgs).toEqual(["--follow"]);
    });

    it("should parse logs subcommand with --lines flag", () => {
      const result = parseDockerSubcommand(["logs", "--lines=200"]);
      expect(result.subcommand).toBe("logs");
      expect(result.subArgs).toEqual(["--lines=200"]);
    });

    it("should parse add-instance subcommand", () => {
      const result = parseDockerSubcommand(["add-instance"]);
      expect(result.subcommand).toBe("add-instance");
    });

    it("should parse add-instance subcommand with host argument", () => {
      const result = parseDockerSubcommand(["add-instance", "gitlab.company.com"]);
      expect(result.subcommand).toBe("add-instance");
      expect(result.subArgs).toEqual(["gitlab.company.com"]);
    });

    it("should parse remove-instance subcommand", () => {
      const result = parseDockerSubcommand(["remove-instance"]);
      expect(result.subcommand).toBe("remove-instance");
    });

    it("should parse remove-instance subcommand with host argument", () => {
      const result = parseDockerSubcommand(["remove-instance", "gitlab.company.com"]);
      expect(result.subcommand).toBe("remove-instance");
      expect(result.subArgs).toEqual(["gitlab.company.com"]);
    });

    it("should return undefined for unknown subcommand", () => {
      const result = parseDockerSubcommand(["unknown-command"]);
      expect(result.subcommand).toBeUndefined();
      expect(result.subArgs).toEqual(["unknown-command"]);
    });

    it("should return undefined for empty args", () => {
      const result = parseDockerSubcommand([]);
      expect(result.subcommand).toBeUndefined();
      expect(result.subArgs).toEqual([]);
    });

    it("should handle all valid subcommands", () => {
      const validSubcommands: DockerSubcommand[] = [
        "status",
        "init",
        "start",
        "stop",
        "restart",
        "upgrade",
        "logs",
        "add-instance",
        "remove-instance",
      ];

      for (const cmd of validSubcommands) {
        const result = parseDockerSubcommand([cmd]);
        expect(result.subcommand).toBe(cmd);
      }
    });
  });

  describe("showStatus", () => {
    it("should display status when Docker is installed and running", () => {
      mockGetDockerStatus.mockReturnValue({
        dockerInstalled: true,
        dockerRunning: true,
        composeInstalled: true,
        container: {
          name: "gitlab-mcp",
          status: "running",
          uptime: "2 hours",
          image: "gitlab-mcp:latest",
          ports: ["3333:3333"],
        },
        instances: [
          {
            host: "gitlab.com",
            name: "GitLab",
            oauth: { clientId: "abc123" },
            defaultPreset: "developer",
          },
        ],
      });

      showStatus();

      expect(consoleLogSpy).toHaveBeenCalledWith("\nDocker Environment:");
      expect(consoleLogSpy).toHaveBeenCalledWith("  Docker installed: ✓");
      expect(consoleLogSpy).toHaveBeenCalledWith("  Docker running: ✓");
    });

    it("should show warning when Docker is not installed", () => {
      mockGetDockerStatus.mockReturnValue({
        dockerInstalled: false,
        dockerRunning: false,
        composeInstalled: false,
        container: null,
        instances: [],
      });

      showStatus();

      expect(consoleLogSpy).toHaveBeenCalledWith("  Docker installed: ✗");
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "\n⚠ Docker is not installed. Install Docker first."
      );
    });

    it("should show warning when Docker is not running", () => {
      mockGetDockerStatus.mockReturnValue({
        dockerInstalled: true,
        dockerRunning: false,
        composeInstalled: true,
        container: null,
        instances: [],
      });

      showStatus();

      expect(consoleLogSpy).toHaveBeenCalledWith("  Docker running: ✗");
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "\n⚠ Docker daemon is not running. Start Docker first."
      );
    });

    it("should show container not found message when no container", () => {
      mockGetDockerStatus.mockReturnValue({
        dockerInstalled: true,
        dockerRunning: true,
        composeInstalled: true,
        container: null,
        instances: [],
      });

      showStatus();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "  Container not found. Run 'gitlab-mcp docker init' to set up."
      );
    });

    it("should show no instances message when instances array is empty", () => {
      mockGetDockerStatus.mockReturnValue({
        dockerInstalled: true,
        dockerRunning: true,
        composeInstalled: true,
        container: { name: "test", status: "running", image: "test", ports: [] },
        instances: [],
      });

      showStatus();

      expect(consoleLogSpy).toHaveBeenCalledWith("  No instances configured.");
    });
  });

  describe("dockerStart", () => {
    it("should start container successfully", () => {
      mockStartContainer.mockReturnValue({ success: true, output: "Started" });

      dockerStart();

      expect(mockStartContainer).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith("✓ Container started");
    });

    it("should handle start failure", () => {
      mockStartContainer.mockReturnValue({ success: false, error: "Failed to start" });

      dockerStart();

      expect(consoleErrorSpy).toHaveBeenCalledWith("✗ Failed to start container: Failed to start");
    });
  });

  describe("dockerStop", () => {
    it("should stop container successfully", () => {
      mockStopContainer.mockReturnValue({ success: true });

      dockerStop();

      expect(mockStopContainer).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith("✓ Container stopped");
    });

    it("should handle stop failure", () => {
      mockStopContainer.mockReturnValue({ success: false, error: "Failed to stop" });

      dockerStop();

      expect(consoleErrorSpy).toHaveBeenCalledWith("✗ Failed to stop container: Failed to stop");
    });
  });

  describe("dockerRestart", () => {
    it("should restart container successfully", () => {
      mockRestartContainer.mockReturnValue({ success: true });

      dockerRestart();

      expect(mockRestartContainer).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith("✓ Container restarted");
    });

    it("should handle restart failure", () => {
      mockRestartContainer.mockReturnValue({ success: false, error: "Failed to restart" });

      dockerRestart();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "✗ Failed to restart container: Failed to restart"
      );
    });
  });

  describe("dockerUpgrade", () => {
    it("should upgrade container successfully", () => {
      mockUpgradeContainer.mockReturnValue({ success: true });

      dockerUpgrade();

      expect(mockUpgradeContainer).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith("✓ Container upgraded to latest version");
    });

    it("should handle upgrade failure", () => {
      mockUpgradeContainer.mockReturnValue({ success: false, error: "Failed to upgrade" });

      dockerUpgrade();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "✗ Failed to upgrade container: Failed to upgrade"
      );
    });
  });

  describe("dockerLogs", () => {
    it("should get logs without follow", () => {
      mockGetLogs.mockReturnValue({ success: true, output: "Log output" });

      dockerLogs(false, 100);

      expect(mockGetLogs).toHaveBeenCalledWith(100);
      expect(consoleLogSpy).toHaveBeenCalledWith("Log output");
    });

    it("should handle logs failure", () => {
      mockGetLogs.mockReturnValue({ success: false, error: "Failed to get logs" });

      dockerLogs(false, 100);

      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to get logs: Failed to get logs");
    });

    it("should tail logs with follow", () => {
      const mockProcess = {
        on: jest.fn(),
      };
      mockTailLogs.mockReturnValue(mockProcess);

      dockerLogs(true, 100);

      expect(mockTailLogs).toHaveBeenCalledWith(true, 100);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Tailing logs (last 100 lines, Ctrl+C to exit)...\n"
      );
    });
  });

  describe("dockerRemoveInstance", () => {
    it("should remove instance successfully", () => {
      mockRemoveInstance.mockReturnValue(true);

      dockerRemoveInstance("gitlab.example.com");

      expect(mockRemoveInstance).toHaveBeenCalledWith("gitlab.example.com");
      expect(consoleLogSpy).toHaveBeenCalledWith("✓ Removed instance: gitlab.example.com");
    });

    it("should handle instance not found", () => {
      mockRemoveInstance.mockReturnValue(false);

      dockerRemoveInstance("unknown.example.com");

      expect(consoleErrorSpy).toHaveBeenCalledWith("✗ Instance not found: unknown.example.com");
    });
  });

  describe("runDockerCommand", () => {
    it("should call showStatus for status subcommand", async () => {
      mockGetDockerStatus.mockReturnValue({
        dockerInstalled: true,
        dockerRunning: true,
        composeInstalled: true,
        container: null,
        instances: [],
      });

      await runDockerCommand(["status"]);

      expect(mockGetDockerStatus).toHaveBeenCalled();
    });

    it("should call dockerStart for start subcommand", async () => {
      mockStartContainer.mockReturnValue({ success: true });

      await runDockerCommand(["start"]);

      expect(mockStartContainer).toHaveBeenCalled();
    });

    it("should call dockerStop for stop subcommand", async () => {
      mockStopContainer.mockReturnValue({ success: true });

      await runDockerCommand(["stop"]);

      expect(mockStopContainer).toHaveBeenCalled();
    });

    it("should call dockerRestart for restart subcommand", async () => {
      mockRestartContainer.mockReturnValue({ success: true });

      await runDockerCommand(["restart"]);

      expect(mockRestartContainer).toHaveBeenCalled();
    });

    it("should call dockerUpgrade for upgrade subcommand", async () => {
      mockUpgradeContainer.mockReturnValue({ success: true });

      await runDockerCommand(["upgrade"]);

      expect(mockUpgradeContainer).toHaveBeenCalled();
    });

    it("should call dockerLogs for logs subcommand", async () => {
      mockGetLogs.mockReturnValue({ success: true, output: "logs" });

      await runDockerCommand(["logs"]);

      expect(mockGetLogs).toHaveBeenCalled();
    });

    it("should call dockerLogs with follow for logs -f", async () => {
      const mockProcess = { on: jest.fn() };
      mockTailLogs.mockReturnValue(mockProcess);

      await runDockerCommand(["logs", "-f"]);

      expect(mockTailLogs).toHaveBeenCalledWith(true, 100);
    });

    it("should call dockerLogs with custom lines", async () => {
      mockGetLogs.mockReturnValue({ success: true, output: "logs" });

      await runDockerCommand(["logs", "--lines=50"]);

      expect(mockGetLogs).toHaveBeenCalledWith(50);
    });

    it("should call dockerRemoveInstance for remove-instance with host", async () => {
      mockRemoveInstance.mockReturnValue(true);

      await runDockerCommand(["remove-instance", "gitlab.example.com"]);

      expect(mockRemoveInstance).toHaveBeenCalledWith("gitlab.example.com");
    });

    it("should show help for unknown subcommand", async () => {
      await runDockerCommand([]);

      expect(consoleLogSpy).toHaveBeenCalledWith("GitLab MCP Docker Commands:\n");
    });
  });
});
