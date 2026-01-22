/**
 * Unit tests for init module exports
 * Validates that all public API is properly exported from index.ts
 */

import {
  runWizard,
  testConnection,
  validateGitLabUrl,
  getPatCreationUrl,
  isGitLabSaas,
  generateServerConfig,
  generateMcpServersJson,
  generateClaudeCodeCommand,
  generateClientConfig,
  generateClaudeDeepLink,
  ROLE_DESCRIPTIONS,
  MCP_CLIENT_INFO,
  ROLE_PRESETS,
} from "../../../../src/cli/init";

describe("init module exports", () => {
  it("should export runWizard function", () => {
    expect(typeof runWizard).toBe("function");
  });

  it("should export connection utilities", () => {
    expect(typeof testConnection).toBe("function");
    expect(typeof validateGitLabUrl).toBe("function");
    expect(typeof getPatCreationUrl).toBe("function");
    expect(typeof isGitLabSaas).toBe("function");
  });

  it("should export config generators", () => {
    expect(typeof generateServerConfig).toBe("function");
    expect(typeof generateMcpServersJson).toBe("function");
    expect(typeof generateClaudeCodeCommand).toBe("function");
    expect(typeof generateClientConfig).toBe("function");
    expect(typeof generateClaudeDeepLink).toBe("function");
  });

  it("should export type constants", () => {
    expect(ROLE_DESCRIPTIONS).toBeDefined();
    expect(MCP_CLIENT_INFO).toBeDefined();
    expect(ROLE_PRESETS).toBeDefined();
  });
});
