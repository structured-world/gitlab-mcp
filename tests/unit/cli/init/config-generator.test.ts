/**
 * Unit tests for config-generator.ts
 * Tests MCP configuration generation for various clients
 */

import {
  generateServerConfig,
  generateMcpServersJson,
  generateClaudeCodeCommand,
  generateClientConfig,
  generateClaudeDeepLink,
} from "../../../../src/cli/init/config-generator";
import { WizardConfig } from "../../../../src/cli/init/types";

describe("config-generator", () => {
  const baseConfig: WizardConfig = {
    instanceUrl: "https://gitlab.example.com",
    token: "glpat-xxxxxxxxxxxx",
    role: "developer",
    client: "claude-desktop",
    readOnly: false,
  };

  describe("generateServerConfig", () => {
    it("should generate basic server config", () => {
      const result = generateServerConfig(baseConfig);

      expect(result.command).toBe("npx");
      expect(result.args).toEqual(["-y", "@structured-world/gitlab-mcp@latest"]);
      expect(result.env.GITLAB_API_URL).toBe("https://gitlab.example.com");
      expect(result.env.GITLAB_TOKEN).toBe("glpat-xxxxxxxxxxxx");
    });

    it("should add preset from role mapping", () => {
      const config: WizardConfig = {
        ...baseConfig,
        role: "senior-developer",
      };

      const result = generateServerConfig(config);

      expect(result.env.GITLAB_MCP_PRESET).toBe("senior-dev");
    });

    it("should add read-only mode when enabled", () => {
      const config: WizardConfig = {
        ...baseConfig,
        readOnly: true,
      };

      const result = generateServerConfig(config);

      expect(result.env.GITLAB_READ_ONLY_MODE).toBe("true");
    });

    it("should not add read-only mode when disabled", () => {
      const result = generateServerConfig(baseConfig);

      expect(result.env.GITLAB_READ_ONLY_MODE).toBeUndefined();
    });

    it("should map all roles to presets correctly", () => {
      const rolePresetMap: Array<[WizardConfig["role"], string]> = [
        ["developer", "developer"],
        ["senior-developer", "senior-dev"],
        ["tech-lead", "full-access"],
        ["devops", "devops"],
        ["reviewer", "code-reviewer"],
        ["readonly", "readonly"],
      ];

      for (const [role, expectedPreset] of rolePresetMap) {
        const config: WizardConfig = { ...baseConfig, role };
        const result = generateServerConfig(config);
        expect(result.env.GITLAB_MCP_PRESET).toBe(expectedPreset);
      }
    });
  });

  describe("generateMcpServersJson", () => {
    it("should generate valid JSON with default server name", () => {
      const result = generateMcpServersJson(baseConfig);
      const parsed = JSON.parse(result);

      expect(parsed.mcpServers).toBeDefined();
      expect(parsed.mcpServers.gitlab).toBeDefined();
      expect(parsed.mcpServers.gitlab.command).toBe("npx");
    });

    it("should use custom server name", () => {
      const result = generateMcpServersJson(baseConfig, "my-gitlab");
      const parsed = JSON.parse(result);

      expect(parsed.mcpServers["my-gitlab"]).toBeDefined();
      expect(parsed.mcpServers.gitlab).toBeUndefined();
    });

    it("should include environment variables", () => {
      const result = generateMcpServersJson(baseConfig);
      const parsed = JSON.parse(result);

      expect(parsed.mcpServers.gitlab.env.GITLAB_API_URL).toBe("https://gitlab.example.com");
      expect(parsed.mcpServers.gitlab.env.GITLAB_TOKEN).toBe("glpat-xxxxxxxxxxxx");
    });
  });

  describe("generateClaudeCodeCommand", () => {
    it("should generate valid CLI command", () => {
      const result = generateClaudeCodeCommand(baseConfig);

      expect(result).toContain("claude mcp add gitlab");
      expect(result).toContain("npx");
      expect(result).toContain("-y");
      expect(result).toContain("@structured-world/gitlab-mcp@latest");
    });

    it("should include environment variables as flags", () => {
      const result = generateClaudeCodeCommand(baseConfig);

      expect(result).toContain('--env GITLAB_API_URL="https://gitlab.example.com"');
      expect(result).toContain('--env GITLAB_TOKEN="glpat-xxxxxxxxxxxx"');
    });

    it("should use custom server name", () => {
      const result = generateClaudeCodeCommand(baseConfig, "work-gitlab");

      expect(result).toContain("claude mcp add work-gitlab");
    });

    it("should include preset env var", () => {
      const config: WizardConfig = {
        ...baseConfig,
        role: "devops",
      };

      const result = generateClaudeCodeCommand(config);

      expect(result).toContain('--env GITLAB_MCP_PRESET="devops"');
    });

    it("should escape shell special characters in env values", () => {
      const config: WizardConfig = {
        ...baseConfig,
        token: 'token"with$special`chars\\and\nnewline',
      };

      const result = generateClaudeCodeCommand(config);

      // Should escape: " $ ` \ and newlines
      expect(result).toContain(
        '--env GITLAB_TOKEN="token\\"with\\$special\\`chars\\\\and\\nnewline"'
      );
    });
  });

  describe("generateClientConfig", () => {
    it("should return CLI type for claude-code client", () => {
      const config: WizardConfig = {
        ...baseConfig,
        client: "claude-code",
      };

      const result = generateClientConfig(config);

      expect(result.type).toBe("cli");
      expect(result.cliCommand).toBeDefined();
      expect(result.cliCommand).toContain("claude mcp add");
    });

    it("should return JSON type for claude-desktop client", () => {
      const config: WizardConfig = {
        ...baseConfig,
        client: "claude-desktop",
      };

      const result = generateClientConfig(config);

      expect(result.type).toBe("json");
      expect(result.content).toContain("mcpServers");
      expect(result.configPath).toBeDefined();
    });

    it("should return JSON type for cursor client", () => {
      const config: WizardConfig = {
        ...baseConfig,
        client: "cursor",
      };

      const result = generateClientConfig(config);

      expect(result.type).toBe("json");
    });

    it("should return instructions type for generic client", () => {
      const config: WizardConfig = {
        ...baseConfig,
        client: "generic",
      };

      const result = generateClientConfig(config);

      expect(result.type).toBe("instructions");
      expect(result.configPath).toBeUndefined();
    });
  });

  describe("generateClaudeDeepLink", () => {
    /**
     * Helper to decode URL-safe Base64
     * URL-safe Base64 uses - instead of +, _ instead of /, and no padding
     */
    function decodeUrlSafeBase64(encoded: string): string {
      // Convert URL-safe Base64 back to standard Base64
      let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      // Add padding if needed
      const padding = base64.length % 4;
      if (padding) {
        base64 += "=".repeat(4 - padding);
      }
      return Buffer.from(base64, "base64").toString("utf-8");
    }

    it("should generate valid deep link URL", () => {
      const result = generateClaudeDeepLink(baseConfig);

      expect(result).toMatch(/^claude:\/\/settings\/mcp\/add\?config=/);
    });

    it("should contain URL-safe base64 encoded config", () => {
      const result = generateClaudeDeepLink(baseConfig);
      const base64Part = result.split("config=")[1];

      // Should not contain standard base64 special chars that need URL encoding
      expect(base64Part).not.toContain("+");
      expect(base64Part).not.toContain("/");
      expect(base64Part).not.toContain("=");

      // Should be decodable
      const decoded = JSON.parse(decodeUrlSafeBase64(base64Part));
      expect(decoded.name).toBe("gitlab");
      expect(decoded.command).toBe("npx");
      expect(decoded.env.GITLAB_API_URL).toBe("https://gitlab.example.com");
    });

    it("should use custom server name in deep link", () => {
      const result = generateClaudeDeepLink(baseConfig, "my-server");
      const base64Part = result.split("config=")[1];
      const decoded = JSON.parse(decodeUrlSafeBase64(base64Part));

      expect(decoded.name).toBe("my-server");
    });
  });
});
