/**
 * Unit tests for install/detector.ts
 * Tests MCP client detection functionality
 */

import { homedir } from "os";
import { join } from "path";
import {
  expandPath,
  getConfigPath,
  isAlreadyConfigured,
  commandExists,
  detectClient,
  detectAllClients,
  getDetectedClients,
  getConfiguredClients,
  isValidBundleId,
} from "../../../../src/cli/install/detector";
import * as fs from "fs";
import * as childProcess from "child_process";

// Mock modules
jest.mock("fs");
jest.mock("child_process");
const mockFs = fs as jest.Mocked<typeof fs>;
const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;

describe("install detector", () => {
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

    it("should handle paths with only ~", () => {
      const result = expandPath("~/");
      expect(result).toBe(join(homedir(), ""));
    });
  });

  describe("getConfigPath", () => {
    it("should return config path for claude-desktop on darwin", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      const result = getConfigPath("claude-desktop");
      expect(result).toContain("Library/Application Support/Claude");

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should return config path for cursor", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      const result = getConfigPath("cursor");
      expect(result).toContain(".cursor/mcp.json");

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should return config path for claude-code", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      const result = getConfigPath("claude-code");
      expect(result).toContain(".claude.json");

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("isAlreadyConfigured", () => {
    it("should return false if config file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = isAlreadyConfigured("/path/to/config.json");
      expect(result).toBe(false);
    });

    it("should return true if gitlab is configured in mcpServers", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            gitlab: { command: "npx", args: [] },
          },
        })
      );

      const result = isAlreadyConfigured("/path/to/config.json");
      expect(result).toBe(true);
    });

    it("should return true if gitlab-mcp is configured in mcpServers", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            "gitlab-mcp": { command: "npx", args: [] },
          },
        })
      );

      const result = isAlreadyConfigured("/path/to/config.json");
      expect(result).toBe(true);
    });

    it("should return true if gitlab is configured in servers (vscode format)", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          servers: {
            gitlab: { command: "npx", args: [] },
          },
        })
      );

      const result = isAlreadyConfigured("/path/to/config.json");
      expect(result).toBe(true);
    });

    it("should return false if other servers are configured but not gitlab", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            github: { command: "npx", args: [] },
          },
        })
      );

      const result = isAlreadyConfigured("/path/to/config.json");
      expect(result).toBe(false);
    });

    it("should return false on JSON parse error", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("invalid json");

      const result = isAlreadyConfigured("/path/to/config.json");
      expect(result).toBe(false);
    });

    it("should return false if config is empty object", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = isAlreadyConfigured("/path/to/config.json");
      expect(result).toBe(false);
    });
  });

  describe("commandExists", () => {
    it("should return true if command exists", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "/usr/bin/claude",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = commandExists("claude");
      expect(result).toBe(true);
    });

    it("should return false if command does not exist", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "not found",
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = commandExists("nonexistent");
      expect(result).toBe(false);
    });

    it("should return false if spawn throws error", () => {
      mockChildProcess.spawnSync.mockImplementation(() => {
        throw new Error("spawn error");
      });

      const result = commandExists("claude");
      expect(result).toBe(false);
    });
  });

  describe("detectClient", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should detect claude-code via CLI command", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "/usr/local/bin/claude",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      mockFs.existsSync.mockReturnValue(false);

      const result = detectClient("claude-code");
      expect(result.detected).toBe(true);
      expect(result.method).toBe("cli-command");
    });

    it("should detect cursor via config file", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      // Config dir exists
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("{}");

      const result = detectClient("cursor");
      expect(result.detected).toBe(true);
      expect(result.method).toBe("config-file");
    });

    it("should mark client as already configured if gitlab found", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: { gitlab: { command: "npx" } },
        })
      );

      const result = detectClient("cursor");
      expect(result.alreadyConfigured).toBe(true);
    });

    it("should return configExists true when config file exists", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("{}");

      const result = detectClient("cursor");
      expect(result.configExists).toBe(true);
    });
  });

  describe("detectAllClients", () => {
    it("should return results for all installable clients", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      mockFs.existsSync.mockReturnValue(false);

      const results = detectAllClients();
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => "client" in r && "detected" in r)).toBe(true);
    });
  });

  describe("getDetectedClients", () => {
    it("should return only detected clients", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "/usr/local/bin/claude",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      mockFs.existsSync.mockReturnValue(false);

      const results = getDetectedClients();
      expect(results.every(r => r.detected === true)).toBe(true);
    });
  });

  describe("getConfiguredClients", () => {
    it("should return only configured clients", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: { gitlab: { command: "npx" } },
        })
      );

      const results = getConfiguredClients();
      expect(results.every(r => r.alreadyConfigured === true)).toBe(true);
    });
  });

  describe("isValidBundleId", () => {
    it("should accept valid reverse-domain bundle IDs", () => {
      expect(isValidBundleId("com.example")).toBe(true);
      expect(isValidBundleId("com.example.app")).toBe(true);
      expect(isValidBundleId("org.test.MyApp")).toBe(true);
      expect(isValidBundleId("com.apple.Safari")).toBe(true);
      expect(isValidBundleId("io.cursor.Cursor")).toBe(true);
    });

    it("should accept bundle IDs with hyphens", () => {
      expect(isValidBundleId("org.test-app.Main")).toBe(true);
      expect(isValidBundleId("com.google-chrome.Chrome")).toBe(true);
      expect(isValidBundleId("io.my-company.my-app")).toBe(true);
    });

    it("should reject segments starting with hyphen", () => {
      expect(isValidBundleId("-com.example")).toBe(false);
      expect(isValidBundleId("com.-example")).toBe(false);
      expect(isValidBundleId("com.example.-app")).toBe(false);
    });

    it("should reject single-segment bundle IDs", () => {
      expect(isValidBundleId("a")).toBe(false);
      expect(isValidBundleId("com")).toBe(false);
      expect(isValidBundleId("example")).toBe(false);
    });

    it("should reject empty or invalid formats", () => {
      expect(isValidBundleId("")).toBe(false);
      expect(isValidBundleId(".")).toBe(false);
      expect(isValidBundleId("com.")).toBe(false);
      expect(isValidBundleId(".com")).toBe(false);
      expect(isValidBundleId("com..example")).toBe(false);
    });

    it("should reject command injection attempts", () => {
      expect(isValidBundleId('com.example"; rm -rf /')).toBe(false);
      expect(isValidBundleId("com.example$(whoami)")).toBe(false);
      expect(isValidBundleId("com.example`id`")).toBe(false);
      expect(isValidBundleId("com.example|cat /etc/passwd")).toBe(false);
    });
  });
});
