/**
 * Unit tests for install/types.ts
 * Tests type definitions and constants
 */

import {
  CLIENT_METADATA,
  INSTALLABLE_CLIENTS,
  InstallableClient,
} from "../../../../src/cli/install/types";

describe("install types", () => {
  describe("INSTALLABLE_CLIENTS", () => {
    it("should contain all 7 installable clients", () => {
      expect(INSTALLABLE_CLIENTS).toHaveLength(7);
      expect(INSTALLABLE_CLIENTS).toContain("claude-desktop");
      expect(INSTALLABLE_CLIENTS).toContain("claude-code");
      expect(INSTALLABLE_CLIENTS).toContain("cursor");
      expect(INSTALLABLE_CLIENTS).toContain("vscode-copilot");
      expect(INSTALLABLE_CLIENTS).toContain("windsurf");
      expect(INSTALLABLE_CLIENTS).toContain("cline");
      expect(INSTALLABLE_CLIENTS).toContain("roo-code");
    });

    it("should not contain generic client", () => {
      expect(INSTALLABLE_CLIENTS).not.toContain("generic");
    });
  });

  describe("CLIENT_METADATA", () => {
    it("should have metadata for all installable clients", () => {
      for (const client of INSTALLABLE_CLIENTS) {
        expect(CLIENT_METADATA[client]).toBeDefined();
        expect(CLIENT_METADATA[client].name).toBeDefined();
        expect(typeof CLIENT_METADATA[client].name).toBe("string");
      }
    });

    it("should have config paths for each platform", () => {
      for (const client of INSTALLABLE_CLIENTS) {
        const metadata = CLIENT_METADATA[client];
        expect(metadata.configPaths).toBeDefined();
        // All clients should have at least darwin config
        expect(metadata.configPaths.darwin).toBeDefined();
      }
    });

    it("should have detection method for all clients", () => {
      const validMethods = ["config-file", "cli-command", "app-bundle"];

      for (const client of INSTALLABLE_CLIENTS) {
        const metadata = CLIENT_METADATA[client];
        expect(validMethods).toContain(metadata.detectionMethod);
      }
    });

    it("should have correct human-readable names", () => {
      expect(CLIENT_METADATA["claude-desktop"].name).toBe("Claude Desktop");
      expect(CLIENT_METADATA["claude-code"].name).toBe("Claude Code");
      expect(CLIENT_METADATA["cursor"].name).toBe("Cursor");
      expect(CLIENT_METADATA["vscode-copilot"].name).toBe("VS Code (GitHub Copilot)");
      expect(CLIENT_METADATA["windsurf"].name).toBe("Windsurf");
      expect(CLIENT_METADATA["cline"].name).toBe("Cline");
      expect(CLIENT_METADATA["roo-code"].name).toBe("Roo Code");
    });

    it("should only support CLI install for claude-code", () => {
      expect(CLIENT_METADATA["claude-code"].supportsCliInstall).toBe(true);
      expect(CLIENT_METADATA["claude-desktop"].supportsCliInstall).toBe(false);
      expect(CLIENT_METADATA["cursor"].supportsCliInstall).toBe(false);
      expect(CLIENT_METADATA["vscode-copilot"].supportsCliInstall).toBe(false);
      expect(CLIENT_METADATA["windsurf"].supportsCliInstall).toBe(false);
      expect(CLIENT_METADATA["cline"].supportsCliInstall).toBe(false);
      expect(CLIENT_METADATA["roo-code"].supportsCliInstall).toBe(false);
    });

    it("should have CLI command for claude-code", () => {
      expect(CLIENT_METADATA["claude-code"].cliCommand).toBe("claude");
    });

    it("should have app bundle ID for claude-desktop", () => {
      expect(CLIENT_METADATA["claude-desktop"].appBundleId).toBe("com.anthropic.claudefordesktop");
    });

    it("should use cli-command detection for claude-code", () => {
      expect(CLIENT_METADATA["claude-code"].detectionMethod).toBe("cli-command");
    });

    it("should use app-bundle detection for claude-desktop", () => {
      expect(CLIENT_METADATA["claude-desktop"].detectionMethod).toBe("app-bundle");
    });

    it("should use config-file detection for other clients", () => {
      const configFileClients: InstallableClient[] = [
        "cursor",
        "vscode-copilot",
        "windsurf",
        "cline",
        "roo-code",
      ];

      for (const client of configFileClients) {
        expect(CLIENT_METADATA[client].detectionMethod).toBe("config-file");
      }
    });
  });
});
