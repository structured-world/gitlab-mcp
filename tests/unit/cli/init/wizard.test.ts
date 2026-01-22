/**
 * Unit tests for wizard.ts
 * Tests the interactive init wizard flow
 */

import * as p from "@clack/prompts";
import { runWizard } from "../../../../src/cli/init/wizard";
import * as connection from "../../../../src/cli/init/connection";
import * as configGenerator from "../../../../src/cli/init/config-generator";
import * as browser from "../../../../src/cli/init/browser";

// Mock all @clack/prompts functions
jest.mock("@clack/prompts", () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  cancel: jest.fn(),
  select: jest.fn(),
  text: jest.fn(),
  confirm: jest.fn(),
  password: jest.fn(),
  spinner: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
  note: jest.fn(),
  log: {
    info: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    step: jest.fn(),
  },
  isCancel: jest.fn(() => false),
}));

// Mock browser module
jest.mock("../../../../src/cli/init/browser", () => ({
  openUrl: jest.fn().mockResolvedValue(true),
}));
const mockOpenUrl = browser.openUrl as jest.Mock;

// Mock child_process for spawnSync
const mockSpawnSync = jest.fn().mockReturnValue({ status: 0 });
jest.mock("child_process", () => ({
  spawnSync: mockSpawnSync,
}));

// Mock connection module
jest.mock("../../../../src/cli/init/connection", () => ({
  testConnection: jest.fn(),
  validateGitLabUrl: jest.fn(() => ({ valid: true })),
  getPatCreationUrl: jest.fn(() => "https://gitlab.com/-/user_settings/personal_access_tokens"),
}));

// Mock config generator
jest.mock("../../../../src/cli/init/config-generator", () => ({
  generateClientConfig: jest.fn(() => ({
    type: "json",
    content: '{"mcpServers": {}}',
    configPath: "~/.config/test",
  })),
  generateClaudeDeepLink: jest.fn(() => "claude://test"),
  generateServerConfig: jest.fn(() => ({
    command: "npx",
    args: ["-y", "@structured-world/gitlab-mcp@latest"],
    env: {
      GITLAB_API_URL: "https://gitlab.com",
      GITLAB_TOKEN: "test-token",
      GITLAB_MCP_PRESET: "developer",
    },
  })),
}));

// Mock process.exit
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

describe("wizard", () => {
  beforeEach(() => {
    // Clear call history but keep implementations from module-level mocks
    jest.clearAllMocks();

    // Reset specific mocks that need fresh state
    (p.select as jest.Mock).mockReset().mockResolvedValue("generic");
    (p.text as jest.Mock).mockReset().mockResolvedValue("https://gitlab.example.com");
    (p.confirm as jest.Mock).mockReset().mockResolvedValue(true);
    (p.password as jest.Mock).mockReset().mockResolvedValue("glpat-test-token-12345");
    (p.isCancel as unknown as jest.Mock).mockReset().mockReturnValue(false);

    // Restore spinner mock (cleared by resetAllMocks)
    (p.spinner as jest.Mock).mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
    });

    (connection.testConnection as jest.Mock).mockReset().mockResolvedValue({
      success: true,
      username: "testuser",
    });
  });

  afterAll(() => {
    mockExit.mockRestore();
  });

  describe("runWizard", () => {
    it("should complete successfully with GitLab.com flow", async () => {
      // Setup mocks for GitLab.com flow
      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas") // instance type
        .mockResolvedValueOnce("developer") // role
        .mockResolvedValueOnce("claude-desktop"); // client

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true); // enable write

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-test-token-12345");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "testuser",
        gitlabVersion: "16.5.0",
      });

      await runWizard();

      expect(p.intro).toHaveBeenCalledWith("GitLab MCP Setup Wizard");
      expect(p.outro).toHaveBeenCalled();
      expect(connection.testConnection).toHaveBeenCalledWith(
        "https://gitlab.com",
        "glpat-test-token-12345"
      );
    });

    it("should handle self-hosted GitLab flow", async () => {
      (p.select as jest.Mock)
        .mockResolvedValueOnce("self-hosted") // instance type
        .mockResolvedValueOnce("devops") // role
        .mockResolvedValueOnce("cursor"); // client

      (p.text as jest.Mock).mockResolvedValueOnce("https://gitlab.example.com");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true); // enable write

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-self-hosted-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "admin",
        gitlabVersion: "16.0.0",
      });

      await runWizard();

      expect(p.text).toHaveBeenCalled();
      expect(connection.testConnection).toHaveBeenCalledWith(
        "https://gitlab.example.com",
        "glpat-self-hosted-token"
      );
    });

    it("should call cancel and exit when user cancels", async () => {
      // When user cancels, the wizard should call p.cancel and exit
      // Note: we can't easily test the full cancel flow because process.exit
      // is mocked but doesn't stop execution. Instead, test the cancel detection.
      const cancelSymbol = Symbol.for("cancel");

      (p.select as jest.Mock)
        .mockResolvedValueOnce(cancelSymbol) // cancelled
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("claude-desktop");

      (p.isCancel as unknown as jest.Mock)
        .mockReturnValueOnce(true) // first cancel detected
        .mockReturnValue(false);

      // Need to provide mocks for the rest of the flow since exit doesn't stop
      (p.confirm as jest.Mock).mockResolvedValue(true);
      (p.password as jest.Mock).mockResolvedValue("token");
      (connection.testConnection as jest.Mock).mockResolvedValue({
        success: true,
        username: "user",
      });

      await runWizard();

      expect(p.cancel).toHaveBeenCalledWith("Setup cancelled");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should exit when connection test fails", async () => {
      (p.select as jest.Mock).mockResolvedValueOnce("saas");

      (p.confirm as jest.Mock).mockResolvedValueOnce(true);

      (p.password as jest.Mock).mockResolvedValueOnce("invalid-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: "Invalid token",
      });

      await runWizard();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(p.log.error).toHaveBeenCalled();
    });

    it("should offer to open browser for PAT creation", async () => {
      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("claude-desktop");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(false) // doesn't have token
        .mockResolvedValueOnce(true) // open browser
        .mockResolvedValueOnce(true); // enable write

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-new-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "testuser",
      });

      await runWizard();

      expect(p.note).toHaveBeenCalled();
      expect(mockOpenUrl).toHaveBeenCalled();
    });

    it("should handle read-only mode selection", async () => {
      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("readonly") // readonly role
        .mockResolvedValueOnce("claude-desktop");

      (p.confirm as jest.Mock).mockResolvedValueOnce(true); // has token

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-readonly-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "viewer",
      });

      await runWizard();

      // For readonly role, no write confirmation should be asked
      expect(configGenerator.generateClientConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          readOnly: true,
          role: "readonly",
        })
      );
    });

    it("should generate CLI config for claude-code client", async () => {
      (configGenerator.generateClientConfig as jest.Mock).mockReturnValueOnce({
        type: "cli",
        content: "{}",
        cliCommand: "claude mcp add gitlab npx ...",
      });

      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("claude-code");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true) // enable write
        .mockResolvedValueOnce(false); // don't run now

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "dev",
      });

      await runWizard();

      expect(p.note).toHaveBeenCalledWith(
        "claude mcp add gitlab npx ...",
        "Run this command to install:"
      );
    });

    it("should validate URL input for self-hosted instance", async () => {
      // Capture the validate function from p.text call
      let validateFn: ((value: string) => string | undefined) | undefined;

      (p.text as jest.Mock).mockImplementation(
        async (opts: { validate?: (value: string) => string | undefined }) => {
          validateFn = opts.validate;
          return "https://gitlab.example.com";
        }
      );

      (p.select as jest.Mock)
        .mockResolvedValueOnce("self-hosted")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("cursor");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true); // enable write

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "user",
      });

      // Mock validateGitLabUrl to return error for invalid URL
      (connection.validateGitLabUrl as jest.Mock)
        .mockReturnValueOnce({ valid: false, error: "Invalid URL" })
        .mockReturnValue({ valid: true });

      await runWizard();

      // Verify validate function was captured and works
      expect(validateFn).toBeDefined();
      if (validateFn) {
        // Test invalid URL
        const errorResult = validateFn("invalid");
        expect(errorResult).toBe("Invalid URL");
      }
    });

    it("should validate token length", async () => {
      // Capture the validate function from p.password call
      let validateFn: ((value: string) => string | undefined) | undefined;

      (p.password as jest.Mock).mockImplementation(
        async (opts: { validate?: (value: string) => string | undefined }) => {
          validateFn = opts.validate;
          return "glpat-valid-token-12345";
        }
      );

      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("cursor");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true); // enable write

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "user",
      });

      await runWizard();

      // Verify validate function was captured
      expect(validateFn).toBeDefined();
      if (validateFn) {
        // Test empty token
        expect(validateFn("")).toBe("Token is too short");
        // Test short token
        expect(validateFn("short")).toBe("Token is too short");
        // Test valid token
        expect(validateFn("glpat-valid-token")).toBeUndefined();
      }
    });

    it("should run CLI command when user confirms", async () => {
      mockSpawnSync.mockClear();

      (configGenerator.generateClientConfig as jest.Mock).mockReturnValueOnce({
        type: "cli",
        content: "{}",
        cliCommand: "claude mcp add gitlab npx ...",
      });

      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("claude-code");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true) // enable write
        .mockResolvedValueOnce(true); // run now

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "dev",
      });

      await runWizard();

      // Verify the CLI execution flow was reached and spawnSync was called
      expect(p.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Run this command now?",
        })
      );
      expect(mockSpawnSync).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["mcp", "add", "gitlab"]),
        expect.objectContaining({ stdio: "inherit" })
      );
    });

    it("should handle deep link open failure gracefully", async () => {
      // openUrl returns false when browser open fails
      mockOpenUrl.mockResolvedValueOnce(false);

      (configGenerator.generateClaudeDeepLink as jest.Mock).mockReturnValueOnce(
        "claude://test-deep-link"
      );

      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("claude-desktop");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true) // enable write
        .mockResolvedValueOnce(true); // open deep link

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "user",
      });

      await runWizard();

      // Should show security warning before confirmation
      expect(p.log.warn).toHaveBeenCalledWith(
        "Security: the deep link encodes your GitLab token. " +
          "It may be recorded in OS/app logs. Treat it like a password."
      );
      // Should show warnings and note with deep link when open fails
      expect(p.log.warn).toHaveBeenCalledWith("Could not open Claude Desktop automatically");
      expect(p.note).toHaveBeenCalledWith(
        "claude://test-deep-link",
        "Copy this sensitive link (treat like a password):"
      );
    });

    it("should open deep link successfully for claude-desktop", async () => {
      // openUrl returns true when browser opens successfully
      mockOpenUrl.mockResolvedValueOnce(true);

      (configGenerator.generateClaudeDeepLink as jest.Mock).mockReturnValueOnce(
        "claude://test-deep-link"
      );

      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("claude-desktop");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true) // enable write
        .mockResolvedValueOnce(true); // open deep link

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "user",
      });

      await runWizard();

      expect(mockOpenUrl).toHaveBeenCalledWith("claude://test-deep-link");
      expect(p.log.success).toHaveBeenCalledWith(
        "Claude Desktop should open with the configuration"
      );
    });

    it("should handle cancel on URL input", async () => {
      const cancelSymbol = Symbol.for("cancel");

      (p.select as jest.Mock).mockResolvedValueOnce("self-hosted");

      (p.text as jest.Mock).mockResolvedValueOnce(cancelSymbol);

      (p.isCancel as unknown as jest.Mock)
        .mockReturnValueOnce(false) // instance type
        .mockReturnValueOnce(true) // URL input cancelled
        .mockReturnValue(false);

      // Provide remaining mocks since exit doesn't stop execution
      (p.select as jest.Mock).mockResolvedValueOnce("developer").mockResolvedValueOnce("cursor");
      (p.confirm as jest.Mock).mockResolvedValue(true);
      (p.password as jest.Mock).mockResolvedValue("token");
      (connection.testConnection as jest.Mock).mockResolvedValue({
        success: true,
        username: "user",
      });

      await runWizard();

      expect(p.cancel).toHaveBeenCalledWith("Setup cancelled");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should handle cancel on hasToken confirm", async () => {
      const cancelSymbol = Symbol.for("cancel");

      (p.select as jest.Mock).mockResolvedValueOnce("saas");

      (p.confirm as jest.Mock).mockResolvedValueOnce(cancelSymbol);

      (p.isCancel as unknown as jest.Mock)
        .mockReturnValueOnce(false) // instance type
        .mockReturnValueOnce(true) // hasToken cancelled
        .mockReturnValue(false);

      // Provide remaining mocks
      (p.select as jest.Mock).mockResolvedValueOnce("developer").mockResolvedValueOnce("cursor");
      (p.confirm as jest.Mock).mockResolvedValue(true);
      (p.password as jest.Mock).mockResolvedValue("token");
      (connection.testConnection as jest.Mock).mockResolvedValue({
        success: true,
        username: "user",
      });

      await runWizard();

      expect(p.cancel).toHaveBeenCalledWith("Setup cancelled");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should handle cancel on openBrowser confirm", async () => {
      const cancelSymbol = Symbol.for("cancel");

      (p.select as jest.Mock).mockResolvedValueOnce("saas");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(false) // doesn't have token
        .mockResolvedValueOnce(cancelSymbol); // cancel on open browser

      (p.isCancel as unknown as jest.Mock)
        .mockReturnValueOnce(false) // instance type
        .mockReturnValueOnce(false) // hasToken
        .mockReturnValueOnce(true) // openBrowser cancelled
        .mockReturnValue(false);

      // Provide remaining mocks
      (p.select as jest.Mock).mockResolvedValueOnce("developer").mockResolvedValueOnce("cursor");
      (p.confirm as jest.Mock).mockResolvedValue(true);
      (p.password as jest.Mock).mockResolvedValue("token");
      (connection.testConnection as jest.Mock).mockResolvedValue({
        success: true,
        username: "user",
      });

      await runWizard();

      expect(p.cancel).toHaveBeenCalledWith("Setup cancelled");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should handle cancel on token input", async () => {
      const cancelSymbol = Symbol.for("cancel");

      (p.select as jest.Mock).mockResolvedValueOnce("saas");

      (p.confirm as jest.Mock).mockResolvedValueOnce(true); // has token

      (p.password as jest.Mock).mockResolvedValueOnce(cancelSymbol);

      (p.isCancel as unknown as jest.Mock)
        .mockReturnValueOnce(false) // instance type
        .mockReturnValueOnce(false) // hasToken
        .mockReturnValueOnce(true) // token input cancelled
        .mockReturnValue(false);

      // Provide remaining mocks
      (p.select as jest.Mock).mockResolvedValueOnce("developer").mockResolvedValueOnce("cursor");
      (p.confirm as jest.Mock).mockResolvedValue(true);
      (p.password as jest.Mock).mockResolvedValue("token");
      (connection.testConnection as jest.Mock).mockResolvedValue({
        success: true,
        username: "user",
      });

      await runWizard();

      expect(p.cancel).toHaveBeenCalledWith("Setup cancelled");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should handle cancel on role selection", async () => {
      const cancelSymbol = Symbol.for("cancel");

      (p.select as jest.Mock).mockResolvedValueOnce("saas").mockResolvedValueOnce(cancelSymbol); // cancel on role

      (p.confirm as jest.Mock).mockResolvedValueOnce(true); // has token

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "user",
      });

      (p.isCancel as unknown as jest.Mock)
        .mockReturnValueOnce(false) // instance type
        .mockReturnValueOnce(false) // hasToken
        .mockReturnValueOnce(false) // token
        .mockReturnValueOnce(true) // role cancelled
        .mockReturnValue(false);

      // Provide remaining mocks
      (p.select as jest.Mock).mockResolvedValueOnce("cursor");
      (p.confirm as jest.Mock).mockResolvedValue(true);

      await runWizard();

      expect(p.cancel).toHaveBeenCalledWith("Setup cancelled");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should handle cancel on confirmReadWrite", async () => {
      const cancelSymbol = Symbol.for("cancel");

      (p.select as jest.Mock).mockResolvedValueOnce("saas").mockResolvedValueOnce("developer"); // role (not readonly)

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(cancelSymbol); // cancel on confirmReadWrite

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "user",
      });

      (p.isCancel as unknown as jest.Mock)
        .mockReturnValueOnce(false) // instance type
        .mockReturnValueOnce(false) // hasToken
        .mockReturnValueOnce(false) // token
        .mockReturnValueOnce(false) // role
        .mockReturnValueOnce(true) // confirmReadWrite cancelled
        .mockReturnValue(false);

      // Provide remaining mocks
      (p.select as jest.Mock).mockResolvedValueOnce("cursor");
      (p.confirm as jest.Mock).mockResolvedValue(true);

      await runWizard();

      expect(p.cancel).toHaveBeenCalledWith("Setup cancelled");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should handle cancel on client selection", async () => {
      const cancelSymbol = Symbol.for("cancel");

      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce(cancelSymbol); // cancel on client

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true); // enable write

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "user",
      });

      (p.isCancel as unknown as jest.Mock)
        .mockReturnValueOnce(false) // instance type
        .mockReturnValueOnce(false) // hasToken
        .mockReturnValueOnce(false) // token
        .mockReturnValueOnce(false) // role
        .mockReturnValueOnce(false) // confirmReadWrite
        .mockReturnValueOnce(true) // client cancelled
        .mockReturnValue(false);

      await runWizard();

      expect(p.cancel).toHaveBeenCalledWith("Setup cancelled");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should skip confirmReadWrite for readonly role", async () => {
      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("readonly") // readonly role
        .mockResolvedValueOnce("cursor");

      (p.confirm as jest.Mock).mockResolvedValueOnce(true); // has token only

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "viewer",
      });

      await runWizard();

      // Should only call confirm once (for hasToken)
      expect(p.confirm).toHaveBeenCalledTimes(1);
      expect(configGenerator.generateClientConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          readOnly: true,
          role: "readonly",
        })
      );
    });

    it("should decline deep link for claude-desktop", async () => {
      (configGenerator.generateClaudeDeepLink as jest.Mock).mockReturnValueOnce(
        "claude://test-deep-link"
      );

      (p.select as jest.Mock)
        .mockResolvedValueOnce("saas")
        .mockResolvedValueOnce("developer")
        .mockResolvedValueOnce("claude-desktop");

      (p.confirm as jest.Mock)
        .mockResolvedValueOnce(true) // has token
        .mockResolvedValueOnce(true) // enable write
        .mockResolvedValueOnce(false); // decline deep link

      (p.password as jest.Mock).mockResolvedValueOnce("glpat-token");

      (connection.testConnection as jest.Mock).mockResolvedValueOnce({
        success: true,
        username: "user",
      });

      await runWizard();

      // Should not have called open with deep link
      expect(mockOpenUrl).not.toHaveBeenCalledWith("claude://test-deep-link");
    });
  });
});
