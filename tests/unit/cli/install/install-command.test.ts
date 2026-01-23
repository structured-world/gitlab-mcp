/**
 * Unit tests for install/install-command.ts
 * Tests install command parsing and execution
 */

import {
  parseInstallFlags,
  getClientsFromFlags,
  buildServerConfigFromEnv,
  runInstallCommand,
  runInstallWizard,
  InstallFlags,
} from "../../../../src/cli/install/install-command";
import { McpServerConfig } from "../../../../src/cli/init/types";
import * as p from "@clack/prompts";

// Mock @clack/prompts
jest.mock("@clack/prompts", () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  spinner: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    message: jest.fn(),
  })),
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  },
  note: jest.fn(),
  multiselect: jest.fn(),
  confirm: jest.fn(),
  cancel: jest.fn(),
  isCancel: jest.fn(() => false),
}));

// Mock detector module
jest.mock("../../../../src/cli/install/detector", () => ({
  detectAllClients: jest.fn(() => [
    { client: "claude-desktop", detected: true, alreadyConfigured: false },
    { client: "cursor", detected: true, alreadyConfigured: false },
  ]),
  getDetectedClients: jest.fn(() => [
    { client: "claude-desktop", detected: true, alreadyConfigured: false },
    { client: "cursor", detected: true, alreadyConfigured: false },
  ]),
}));

// Mock installers module
jest.mock("../../../../src/cli/install/installers", () => ({
  installToClients: jest.fn(() => [
    { client: "claude-desktop", success: true, configPath: "/path/to/config" },
  ]),
  generateConfigPreview: jest.fn(() => '{"mcpServers":{"gitlab":{}}}'),
}));

const mockP = p as jest.Mocked<typeof p>;
const { detectAllClients, getDetectedClients } = jest.requireMock(
  "../../../../src/cli/install/detector"
);
const { installToClients, generateConfigPreview } = jest.requireMock(
  "../../../../src/cli/install/installers"
);

describe("install-command", () => {
  describe("parseInstallFlags", () => {
    it("should parse --claude-desktop flag", () => {
      const result = parseInstallFlags(["--claude-desktop"]);
      expect(result.claudeDesktop).toBe(true);
    });

    it("should parse --claude-code flag", () => {
      const result = parseInstallFlags(["--claude-code"]);
      expect(result.claudeCode).toBe(true);
    });

    it("should parse --cursor flag", () => {
      const result = parseInstallFlags(["--cursor"]);
      expect(result.cursor).toBe(true);
    });

    it("should parse --vscode flag", () => {
      const result = parseInstallFlags(["--vscode"]);
      expect(result.vscode).toBe(true);
    });

    it("should parse --cline flag", () => {
      const result = parseInstallFlags(["--cline"]);
      expect(result.cline).toBe(true);
    });

    it("should parse --roo-code flag", () => {
      const result = parseInstallFlags(["--roo-code"]);
      expect(result.rooCode).toBe(true);
    });

    it("should parse --windsurf flag", () => {
      const result = parseInstallFlags(["--windsurf"]);
      expect(result.windsurf).toBe(true);
    });

    it("should parse --all flag", () => {
      const result = parseInstallFlags(["--all"]);
      expect(result.all).toBe(true);
    });

    it("should parse --show flag", () => {
      const result = parseInstallFlags(["--show"]);
      expect(result.show).toBe(true);
    });

    it("should parse --force flag", () => {
      const result = parseInstallFlags(["--force"]);
      expect(result.force).toBe(true);
    });

    it("should parse multiple flags", () => {
      const result = parseInstallFlags(["--claude-desktop", "--cursor", "--force"]);
      expect(result.claudeDesktop).toBe(true);
      expect(result.cursor).toBe(true);
      expect(result.force).toBe(true);
      expect(result.all).toBeUndefined();
    });

    it("should return empty object for no flags", () => {
      const result = parseInstallFlags([]);
      expect(result.claudeDesktop).toBeUndefined();
      expect(result.all).toBeUndefined();
      expect(result.force).toBeUndefined();
    });

    it("should ignore unknown flags", () => {
      const result = parseInstallFlags(["--unknown", "--another-unknown"]);
      expect(Object.keys(result).filter(k => result[k as keyof InstallFlags])).toHaveLength(0);
    });
  });

  describe("getClientsFromFlags", () => {
    it("should return empty array for no flags", () => {
      const result = getClientsFromFlags({});
      expect(result).toHaveLength(0);
    });

    it("should return claude-desktop for claudeDesktop flag", () => {
      const result = getClientsFromFlags({ claudeDesktop: true });
      expect(result).toContain("claude-desktop");
      expect(result).toHaveLength(1);
    });

    it("should return claude-code for claudeCode flag", () => {
      const result = getClientsFromFlags({ claudeCode: true });
      expect(result).toContain("claude-code");
    });

    it("should return cursor for cursor flag", () => {
      const result = getClientsFromFlags({ cursor: true });
      expect(result).toContain("cursor");
    });

    it("should return vscode-copilot for vscode flag", () => {
      const result = getClientsFromFlags({ vscode: true });
      expect(result).toContain("vscode-copilot");
    });

    it("should return cline for cline flag", () => {
      const result = getClientsFromFlags({ cline: true });
      expect(result).toContain("cline");
    });

    it("should return roo-code for rooCode flag", () => {
      const result = getClientsFromFlags({ rooCode: true });
      expect(result).toContain("roo-code");
    });

    it("should return windsurf for windsurf flag", () => {
      const result = getClientsFromFlags({ windsurf: true });
      expect(result).toContain("windsurf");
    });

    it("should return multiple clients for multiple flags", () => {
      const result = getClientsFromFlags({
        claudeDesktop: true,
        cursor: true,
        windsurf: true,
      });
      expect(result).toHaveLength(3);
      expect(result).toContain("claude-desktop");
      expect(result).toContain("cursor");
      expect(result).toContain("windsurf");
    });

    it("should return all 7 clients for all flags", () => {
      const result = getClientsFromFlags({
        claudeDesktop: true,
        claudeCode: true,
        cursor: true,
        vscode: true,
        cline: true,
        rooCode: true,
        windsurf: true,
      });
      expect(result).toHaveLength(7);
    });
  });

  describe("buildServerConfigFromEnv", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should use default gitlab.com URL if not set", () => {
      delete process.env.GITLAB_URL;
      delete process.env.GITLAB_TOKEN;
      delete process.env.GITLAB_MCP_PRESET;

      const result = buildServerConfigFromEnv();

      expect(result.env.GITLAB_URL).toBe("https://gitlab.com");
    });

    it("should use GITLAB_URL from environment", () => {
      process.env.GITLAB_URL = "https://gitlab.example.com";

      const result = buildServerConfigFromEnv();

      expect(result.env.GITLAB_URL).toBe("https://gitlab.example.com");
    });

    it("should include GITLAB_TOKEN from environment", () => {
      process.env.GITLAB_TOKEN = "test-token-123";

      const result = buildServerConfigFromEnv();

      expect(result.env.GITLAB_TOKEN).toBe("test-token-123");
    });

    it("should include GITLAB_MCP_PRESET if set", () => {
      process.env.GITLAB_MCP_PRESET = "developer";

      const result = buildServerConfigFromEnv();

      expect(result.env.GITLAB_MCP_PRESET).toBe("developer");
    });

    it("should not include GITLAB_MCP_PRESET if not set", () => {
      delete process.env.GITLAB_MCP_PRESET;

      const result = buildServerConfigFromEnv();

      expect(result.env.GITLAB_MCP_PRESET).toBeUndefined();
    });

    it("should use npx command", () => {
      const result = buildServerConfigFromEnv();

      expect(result.command).toBe("npx");
      expect(result.args).toContain("-y");
      expect(result.args).toContain("@structured-world/gitlab-mcp");
    });
  });

  describe("runInstallCommand", () => {
    const mockServerConfig: McpServerConfig = {
      command: "npx",
      args: ["-y", "@structured-world/gitlab-mcp"],
      env: { GITLAB_URL: "https://gitlab.com", GITLAB_TOKEN: "test-token" },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should display config preview with --show flag", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const results = await runInstallCommand(mockServerConfig, { show: true });

      expect(results).toEqual([]);
      expect(generateConfigPreview).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should display config for specified client with --show", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await runInstallCommand(mockServerConfig, { show: true, cursor: true });

      expect(generateConfigPreview).toHaveBeenCalledWith("cursor", mockServerConfig);

      consoleSpy.mockRestore();
    });

    it("should install to all detected clients with --all flag", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const results = await runInstallCommand(mockServerConfig, { all: true });

      expect(installToClients).toHaveBeenCalled();
      expect(results).toHaveLength(1);

      consoleSpy.mockRestore();
    });

    it("should install to specified clients", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await runInstallCommand(mockServerConfig, { claudeDesktop: true });

      expect(installToClients).toHaveBeenCalledWith(["claude-desktop"], mockServerConfig, false);

      consoleSpy.mockRestore();
    });

    it("should show error for undetected clients", async () => {
      getDetectedClients.mockReturnValueOnce([]);
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const results = await runInstallCommand(mockServerConfig, { claudeDesktop: true });

      expect(results).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith("No supported MCP clients detected.");

      consoleSpy.mockRestore();
    });

    it("should display backup path when created", async () => {
      installToClients.mockReturnValueOnce([
        { client: "claude-desktop", success: true, backupPath: "/backup/path" },
      ]);
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await runInstallCommand(mockServerConfig, { claudeDesktop: true });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Backup created"));

      consoleSpy.mockRestore();
    });

    it("should display error for failed installations", async () => {
      installToClients.mockReturnValueOnce([
        { client: "claude-desktop", success: false, error: "Permission denied" },
      ]);
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await runInstallCommand(mockServerConfig, { claudeDesktop: true });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));

      consoleSpy.mockRestore();
    });
  });

  describe("runInstallWizard", () => {
    const mockServerConfig: McpServerConfig = {
      command: "npx",
      args: ["-y", "@structured-world/gitlab-mcp"],
      env: { GITLAB_URL: "https://gitlab.com", GITLAB_TOKEN: "test-token" },
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Reset mocks to default behavior
      detectAllClients.mockReturnValue([
        { client: "claude-desktop", detected: true, alreadyConfigured: false },
        { client: "cursor", detected: true, alreadyConfigured: false },
      ]);
      mockP.isCancel.mockReturnValue(false);
    });

    it("should show config preview with --show flag", async () => {
      const results = await runInstallWizard(mockServerConfig, { show: true });

      expect(results).toEqual([]);
      expect(mockP.intro).toHaveBeenCalled();
      expect(mockP.note).toHaveBeenCalled();
      expect(mockP.outro).toHaveBeenCalled();
    });

    it("should return empty when no clients detected", async () => {
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: false },
        { client: "cursor", detected: false },
      ]);

      const results = await runInstallWizard(mockServerConfig, {});

      expect(results).toEqual([]);
      expect(mockP.log.warn).toHaveBeenCalledWith("No MCP clients detected on this system.");
    });

    it("should install to all clients with --all flag", async () => {
      const results = await runInstallWizard(mockServerConfig, { all: true });

      expect(installToClients).toHaveBeenCalledWith(
        ["claude-desktop", "cursor"],
        mockServerConfig,
        false
      );
      expect(results).toHaveLength(1);
    });

    it("should warn about undetected specified clients", async () => {
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: true, alreadyConfigured: false },
      ]);

      await runInstallWizard(mockServerConfig, { cursor: true, claudeDesktop: true });

      expect(mockP.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Skipping undetected clients")
      );
    });

    it("should handle user cancellation during client selection", async () => {
      mockP.multiselect.mockResolvedValueOnce(Symbol.for("cancel"));
      mockP.isCancel.mockReturnValueOnce(true);

      const results = await runInstallWizard(mockServerConfig, {});

      expect(results).toEqual([]);
      expect(mockP.cancel).toHaveBeenCalledWith("Installation cancelled");
    });

    it("should prompt for overwrite when clients already configured", async () => {
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: true, alreadyConfigured: true },
      ]);
      mockP.confirm.mockResolvedValueOnce(true);

      await runInstallWizard(mockServerConfig, { claudeDesktop: true });

      expect(mockP.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("already have gitlab-mcp configured")
      );
      expect(mockP.confirm).toHaveBeenCalled();
    });

    it("should handle cancellation during overwrite confirmation", async () => {
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: true, alreadyConfigured: true },
      ]);
      const cancelSymbol = Symbol.for("cancel");
      mockP.confirm.mockResolvedValueOnce(cancelSymbol);
      // isCancel is called after confirm returns
      mockP.isCancel.mockImplementation(val => val === cancelSymbol);

      const results = await runInstallWizard(mockServerConfig, { claudeDesktop: true });

      expect(results).toEqual([]);
      expect(mockP.cancel).toHaveBeenCalledWith("Installation cancelled");

      // Reset isCancel mock
      mockP.isCancel.mockReturnValue(false);
    });

    it("should skip already configured clients if user declines overwrite", async () => {
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: true, alreadyConfigured: true },
        { client: "cursor", detected: true, alreadyConfigured: false },
      ]);
      mockP.confirm.mockResolvedValueOnce(false);
      mockP.isCancel.mockReturnValue(false);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      await runInstallWizard(mockServerConfig, { claudeDesktop: true, cursor: true });

      // forceInstall is false because user declined overwrite (userConfirmedOverwrite = false)
      // and --force flag was not set
      expect(installToClients).toHaveBeenCalledWith(["cursor"], mockServerConfig, false);
      consoleSpy.mockRestore();
    });

    it("should return empty when all clients declined and no new clients", async () => {
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: true, alreadyConfigured: true },
      ]);
      mockP.confirm.mockResolvedValueOnce(false);

      const results = await runInstallWizard(mockServerConfig, { claudeDesktop: true });

      expect(results).toEqual([]);
      expect(mockP.log.info).toHaveBeenCalledWith("No new clients to configure.");
    });

    it("should use interactive multiselect when no clients specified", async () => {
      mockP.multiselect.mockResolvedValueOnce(["claude-desktop"]);

      await runInstallWizard(mockServerConfig, {});

      expect(mockP.multiselect).toHaveBeenCalled();
    });

    it("should return empty when no clients selected", async () => {
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: true, alreadyConfigured: false },
      ]);
      // windsurf flag is passed but windsurf is not detected,
      // so targetClients will be empty without calling multiselect

      const results = await runInstallWizard(mockServerConfig, { windsurf: true });

      // windsurf is not detected, so targetClients will be empty
      expect(results).toEqual([]);
    });

    it("should display successful and failed installations", async () => {
      installToClients.mockReturnValueOnce([
        { client: "claude-desktop", success: true, configPath: "/path", backupPath: "/backup" },
        { client: "cursor", success: false, error: "Failed" },
      ]);
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await runInstallWizard(mockServerConfig, { all: true });

      expect(mockP.log.success).toHaveBeenCalled();
      expect(mockP.log.error).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should use force flag when set", async () => {
      await runInstallWizard(mockServerConfig, { claudeDesktop: true, force: true });

      expect(installToClients).toHaveBeenCalledWith(["claude-desktop"], mockServerConfig, true);
    });

    it("should pass forceInstall=true when user confirms overwrite", async () => {
      /**
       * Tests that when a client is already configured and user confirms overwrite,
       * forceInstall is set to true (userConfirmedOverwrite = true).
       */
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: true, alreadyConfigured: true },
      ]);
      mockP.confirm.mockResolvedValueOnce(true); // user confirms overwrite
      mockP.isCancel.mockReturnValue(false);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      await runInstallWizard(mockServerConfig, { claudeDesktop: true });

      // forceInstall should be true because user confirmed overwrite
      expect(installToClients).toHaveBeenCalledWith(["claude-desktop"], mockServerConfig, true);
      consoleSpy.mockRestore();
    });

    it("should pass forceInstall=false when no overwrite needed and no --force flag", async () => {
      /**
       * Tests that when clients are not already configured and --force flag is not set,
       * forceInstall is correctly set to false.
       */
      detectAllClients.mockReturnValueOnce([
        { client: "claude-desktop", detected: true, alreadyConfigured: false },
        { client: "cursor", detected: true, alreadyConfigured: false },
      ]);
      mockP.isCancel.mockReturnValue(false);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      await runInstallWizard(mockServerConfig, { claudeDesktop: true, cursor: true });

      // forceInstall should be false - no force flag and no overwrite confirmation needed
      expect(installToClients).toHaveBeenCalledWith(
        ["claude-desktop", "cursor"],
        mockServerConfig,
        false
      );
      consoleSpy.mockRestore();
    });
  });

  describe("type guard validation", () => {
    /**
     * Tests for the runtime type guard validation (isInstallableClient)
     * that filters multiselect results to valid InstallableClient values.
     * The type guard ensures only valid InstallableClient values are processed.
     */
    const mockServerConfig: McpServerConfig = {
      command: "npx",
      args: ["-y", "@structured-world/gitlab-mcp"],
      env: { GITLAB_URL: "https://gitlab.com", GITLAB_TOKEN: "test-token" },
    };

    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      // Reset mockP.isCancel to always return false
      mockP.isCancel.mockReturnValue(false);
      // Re-setup spinner mock (might be affected by previous tests)
      mockP.spinner.mockReturnValue({
        start: jest.fn(),
        stop: jest.fn(),
        message: jest.fn(),
      });
      consoleSpy = jest.spyOn(console, "log").mockImplementation();
      // Reset installToClients mock to return success
      installToClients.mockReturnValue([
        { client: "claude-desktop", success: true, configPath: "/path/to/config" },
        { client: "cursor", success: true, configPath: "/path/to/config" },
      ]);
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it("should accept valid client values from multiselect", async () => {
      // Setup detected clients
      detectAllClients.mockReturnValue([
        { client: "claude-desktop", detected: true, alreadyConfigured: false },
        { client: "cursor", detected: true, alreadyConfigured: false },
      ]);
      // User selects both valid clients from multiselect
      mockP.multiselect.mockResolvedValueOnce(["claude-desktop", "cursor"]);

      await runInstallWizard(mockServerConfig, {});

      // installToClients should be called with valid clients
      expect(installToClients).toHaveBeenCalledWith(
        ["claude-desktop", "cursor"],
        mockServerConfig,
        false
      );
    });

    it("should filter out invalid client values from multiselect", async () => {
      // Setup one detected client
      detectAllClients.mockReturnValue([
        { client: "claude-desktop", detected: true, alreadyConfigured: false },
      ]);
      // Simulate multiselect returning mix of valid and invalid values
      // This tests the type guard isInstallableClient at install-command.ts:205-206
      mockP.multiselect.mockResolvedValueOnce(["claude-desktop", "invalid-client"]);

      const results = await runInstallWizard(mockServerConfig, {});

      // Should cancel because length mismatch after filtering
      expect(mockP.log.error).toHaveBeenCalledWith("Invalid client selection received.");
      expect(mockP.cancel).toHaveBeenCalledWith("Installation cancelled");
      expect(results).toEqual([]);
    });

    it("should reject all invalid client values", async () => {
      // Setup one detected client (required so we get to multiselect)
      detectAllClients.mockReturnValue([
        { client: "claude-desktop", detected: true, alreadyConfigured: false },
      ]);
      // Simulate multiselect returning only invalid values
      mockP.multiselect.mockResolvedValueOnce(["not-a-client", "also-invalid"]);

      const results = await runInstallWizard(mockServerConfig, {});

      expect(mockP.log.error).toHaveBeenCalledWith("Invalid client selection received.");
      expect(mockP.cancel).toHaveBeenCalledWith("Installation cancelled");
      expect(results).toEqual([]);
    });
  });
});
