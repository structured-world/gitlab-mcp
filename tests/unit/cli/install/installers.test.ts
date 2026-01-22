/**
 * Unit tests for install/installers.ts
 * Tests MCP client installation functionality
 */

import {
  installToClient,
  installToClients,
  generateConfigPreview,
} from "../../../../src/cli/install/installers";
import { McpServerConfig } from "../../../../src/cli/init/types";
import * as fs from "fs";
import * as childProcess from "child_process";

// Mock modules
jest.mock("fs");
jest.mock("child_process");
jest.mock("../../../../src/cli/install/backup", () => ({
  createBackup: jest.fn(() => ({ created: true, backupPath: "/backup/path" })),
}));
jest.mock("../../../../src/cli/install/detector", () => ({
  expandPath: jest.fn((p: string) => p.replace("~", "/home/user")),
  getConfigPath: jest.fn((client: string) => {
    const paths: Record<string, string> = {
      "claude-desktop": "~/Library/Application Support/Claude/claude_desktop_config.json",
      "claude-code": "~/.claude.json",
      cursor: "~/.cursor/mcp.json",
      "vscode-copilot": ".vscode/mcp.json",
      windsurf: "~/.codeium/windsurf/mcp_config.json",
      cline:
        "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
      "roo-code": "~/.roo/mcp.json",
    };
    return paths[client];
  }),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;

describe("install installers", () => {
  const mockServerConfig: McpServerConfig = {
    command: "npx",
    args: ["-y", "@structured-world/gitlab-mcp"],
    env: {
      GITLAB_URL: "https://gitlab.com",
      GITLAB_TOKEN: "test-token",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue("{}");
  });

  describe("generateConfigPreview", () => {
    it("should generate mcpServers format for most clients", () => {
      const result = generateConfigPreview("claude-desktop", mockServerConfig);
      const parsed = JSON.parse(result);

      expect(parsed.mcpServers).toBeDefined();
      expect(parsed.mcpServers.gitlab).toBeDefined();
      expect(parsed.mcpServers.gitlab.command).toBe("npx");
      expect(parsed.mcpServers.gitlab.args).toEqual(["-y", "@structured-world/gitlab-mcp"]);
      expect(parsed.mcpServers.gitlab.env).toEqual(mockServerConfig.env);
    });

    it("should generate servers format for vscode-copilot", () => {
      const result = generateConfigPreview("vscode-copilot", mockServerConfig);
      const parsed = JSON.parse(result);

      expect(parsed.servers).toBeDefined();
      expect(parsed.servers.gitlab).toBeDefined();
      expect(parsed.mcpServers).toBeUndefined();
    });

    it("should include env only if present", () => {
      const configWithoutEnv: McpServerConfig = {
        command: "npx",
        args: [],
        env: {},
      };

      const result = generateConfigPreview("claude-desktop", configWithoutEnv);
      const parsed = JSON.parse(result);

      expect(parsed.mcpServers.gitlab.env).toBeUndefined();
    });
  });

  describe("installToClient - JSON config clients", () => {
    it("should install to claude-desktop successfully", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => undefined);
      mockFs.mkdirSync.mockImplementation(() => undefined);

      const result = installToClient("claude-desktop", mockServerConfig);

      expect(result.success).toBe(true);
      expect(result.client).toBe("claude-desktop");
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("should fail if already configured without force", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            gitlab: { command: "old" },
          },
        })
      );

      const result = installToClient("claude-desktop", mockServerConfig, false);

      expect(result.success).toBe(false);
      expect(result.wasAlreadyConfigured).toBe(true);
      expect(result.error).toContain("already configured");
    });

    it("should overwrite if already configured with force", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            gitlab: { command: "old" },
          },
        })
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const result = installToClient("claude-desktop", mockServerConfig, true);

      expect(result.success).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("should preserve existing config when adding gitlab", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            github: { command: "other" },
          },
        })
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const result = installToClient("cursor", mockServerConfig);

      expect(result.success).toBe(true);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1] as string);

      expect(writtenContent.mcpServers.github).toBeDefined();
      expect(writtenContent.mcpServers.gitlab).toBeDefined();
    });

    it("should create backup when config exists", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: {
            github: { command: "other" },
          },
        })
      );
      mockFs.writeFileSync.mockImplementation(() => undefined);

      const result = installToClient("cursor", mockServerConfig);

      expect(result.success).toBe(true);
      expect(result.backupPath).toBe("/backup/path");
    });
  });

  describe("installToClient - claude-code (CLI)", () => {
    it("should use claude mcp add command", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 0,
        stdout: "Success",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = installToClient("claude-code", mockServerConfig);

      expect(result.success).toBe(true);
      expect(mockChildProcess.spawnSync).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["mcp", "add", "gitlab"]),
        expect.any(Object)
      );
    });

    it("should fail if claude command fails", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Error: command failed",
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = installToClient("claude-code", mockServerConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("command failed");
    });

    it("should detect already configured error", () => {
      mockChildProcess.spawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Server already exists",
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = installToClient("claude-code", mockServerConfig);

      expect(result.success).toBe(false);
      expect(result.wasAlreadyConfigured).toBe(true);
    });

    it("should remove existing config with force", () => {
      // First call for mcp list
      mockChildProcess.spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: "gitlab - configured",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      // Second call for mcp remove
      mockChildProcess.spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: "Removed",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });
      // Third call for mcp add
      mockChildProcess.spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: "Added",
        stderr: "",
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = installToClient("claude-code", mockServerConfig, true);

      expect(result.success).toBe(true);
      expect(mockChildProcess.spawnSync).toHaveBeenCalledTimes(3);
    });
  });

  describe("installToClients", () => {
    it("should install to multiple clients", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => undefined);
      mockFs.mkdirSync.mockImplementation(() => undefined);

      const results = installToClients(["cursor", "windsurf"], mockServerConfig);

      expect(results).toHaveLength(2);
      expect(results[0].client).toBe("cursor");
      expect(results[1].client).toBe("windsurf");
    });

    it("should return results for all clients even if some fail", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          mcpServers: { gitlab: {} },
        })
      );

      const results = installToClients(["cursor", "windsurf"], mockServerConfig, false);

      expect(results).toHaveLength(2);
      expect(results.every(r => !r.success)).toBe(true);
    });
  });
});
