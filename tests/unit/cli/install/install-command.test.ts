/**
 * Unit tests for install/install-command.ts
 * Tests install command parsing and execution
 */

import {
  parseInstallFlags,
  getClientsFromFlags,
  buildServerConfigFromEnv,
  InstallFlags,
} from "../../../../src/cli/install/install-command";

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
});
