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
} from "../../../../src/cli/install/detector";
import * as fs from "fs";

// Mock fs module
jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

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
});
