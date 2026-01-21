/**
 * Unit tests for types.ts
 * Tests type definitions and constants
 */

import {
  ROLE_DESCRIPTIONS,
  ROLE_PRESETS,
  MCP_CLIENT_INFO,
  UserRole,
  McpClient,
} from "../../../../src/cli/init/types";

describe("init types", () => {
  describe("ROLE_DESCRIPTIONS", () => {
    it("should have descriptions for all roles", () => {
      const roles: UserRole[] = [
        "developer",
        "senior-developer",
        "tech-lead",
        "devops",
        "reviewer",
        "readonly",
      ];

      for (const role of roles) {
        expect(ROLE_DESCRIPTIONS[role]).toBeDefined();
        expect(typeof ROLE_DESCRIPTIONS[role]).toBe("string");
        expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(0);
      }
    });

    it("should have unique descriptions", () => {
      const descriptions = Object.values(ROLE_DESCRIPTIONS);
      const uniqueDescriptions = new Set(descriptions);

      expect(uniqueDescriptions.size).toBe(descriptions.length);
    });
  });

  describe("ROLE_PRESETS", () => {
    it("should map all roles to presets", () => {
      const roles: UserRole[] = [
        "developer",
        "senior-developer",
        "tech-lead",
        "devops",
        "reviewer",
        "readonly",
      ];

      for (const role of roles) {
        expect(ROLE_PRESETS[role]).toBeDefined();
        expect(typeof ROLE_PRESETS[role]).toBe("string");
      }
    });

    it("should have correct preset mappings", () => {
      expect(ROLE_PRESETS["developer"]).toBe("developer");
      expect(ROLE_PRESETS["senior-developer"]).toBe("senior-dev");
      expect(ROLE_PRESETS["tech-lead"]).toBe("full-access");
      expect(ROLE_PRESETS["devops"]).toBe("devops");
      expect(ROLE_PRESETS["reviewer"]).toBe("code-reviewer");
      expect(ROLE_PRESETS["readonly"]).toBe("readonly");
    });
  });

  describe("MCP_CLIENT_INFO", () => {
    it("should have info for all clients", () => {
      const clients: McpClient[] = [
        "claude-desktop",
        "claude-code",
        "cursor",
        "vscode-copilot",
        "windsurf",
        "cline",
        "roo-code",
        "generic",
      ];

      for (const client of clients) {
        expect(MCP_CLIENT_INFO[client]).toBeDefined();
        expect(MCP_CLIENT_INFO[client].name).toBeDefined();
        expect(typeof MCP_CLIENT_INFO[client].supportsCliInstall).toBe("boolean");
      }
    });

    it("should have config paths for all clients", () => {
      const clients: McpClient[] = [
        "claude-desktop",
        "claude-code",
        "cursor",
        "vscode-copilot",
        "windsurf",
        "cline",
        "roo-code",
        "generic",
      ];

      for (const client of clients) {
        expect(typeof MCP_CLIENT_INFO[client].configPath).toBe("string");
      }
    });

    it("should have empty config path for generic client", () => {
      expect(MCP_CLIENT_INFO["generic"].configPath).toBe("");
    });

    it("should have human-readable names", () => {
      expect(MCP_CLIENT_INFO["claude-desktop"].name).toBe("Claude Desktop");
      expect(MCP_CLIENT_INFO["claude-code"].name).toBe("Claude Code");
      expect(MCP_CLIENT_INFO["cursor"].name).toBe("Cursor");
      expect(MCP_CLIENT_INFO["windsurf"].name).toBe("Windsurf");
      expect(MCP_CLIENT_INFO["cline"].name).toBe("Cline");
      expect(MCP_CLIENT_INFO["vscode-copilot"].name).toBe("VS Code (GitHub Copilot)");
      expect(MCP_CLIENT_INFO["roo-code"].name).toBe("Roo Code");
      expect(MCP_CLIENT_INFO["generic"].name).toBe("Other / Generic");
    });

    it("should only support CLI install for claude-code", () => {
      expect(MCP_CLIENT_INFO["claude-code"].supportsCliInstall).toBe(true);
      expect(MCP_CLIENT_INFO["claude-desktop"].supportsCliInstall).toBe(false);
      expect(MCP_CLIENT_INFO["cursor"].supportsCliInstall).toBe(false);
      expect(MCP_CLIENT_INFO["generic"].supportsCliInstall).toBe(false);
    });
  });
});
