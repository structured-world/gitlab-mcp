/**
 * Unit tests for install/index.ts
 * Tests module exports
 */

import * as installModule from "../../../../src/cli/install";

describe("install module exports", () => {
  describe("types exports", () => {
    it("should export CLIENT_METADATA", () => {
      expect(installModule.CLIENT_METADATA).toBeDefined();
    });

    it("should export INSTALLABLE_CLIENTS", () => {
      expect(installModule.INSTALLABLE_CLIENTS).toBeDefined();
      expect(Array.isArray(installModule.INSTALLABLE_CLIENTS)).toBe(true);
    });
  });

  describe("detector exports", () => {
    it("should export expandPath", () => {
      expect(installModule.expandPath).toBeDefined();
      expect(typeof installModule.expandPath).toBe("function");
    });

    it("should export getConfigPath", () => {
      expect(installModule.getConfigPath).toBeDefined();
      expect(typeof installModule.getConfigPath).toBe("function");
    });

    it("should export detectClient", () => {
      expect(installModule.detectClient).toBeDefined();
      expect(typeof installModule.detectClient).toBe("function");
    });

    it("should export detectAllClients", () => {
      expect(installModule.detectAllClients).toBeDefined();
      expect(typeof installModule.detectAllClients).toBe("function");
    });

    it("should export getDetectedClients", () => {
      expect(installModule.getDetectedClients).toBeDefined();
      expect(typeof installModule.getDetectedClients).toBe("function");
    });

    it("should export getConfiguredClients", () => {
      expect(installModule.getConfiguredClients).toBeDefined();
      expect(typeof installModule.getConfiguredClients).toBe("function");
    });

    it("should export isAlreadyConfigured", () => {
      expect(installModule.isAlreadyConfigured).toBeDefined();
      expect(typeof installModule.isAlreadyConfigured).toBe("function");
    });

    it("should export commandExists", () => {
      expect(installModule.commandExists).toBeDefined();
      expect(typeof installModule.commandExists).toBe("function");
    });
  });

  describe("backup exports", () => {
    it("should export createBackup", () => {
      expect(installModule.createBackup).toBeDefined();
      expect(typeof installModule.createBackup).toBe("function");
    });

    it("should export restoreBackup", () => {
      expect(installModule.restoreBackup).toBeDefined();
      expect(typeof installModule.restoreBackup).toBe("function");
    });

    it("should export generateBackupFilename", () => {
      expect(installModule.generateBackupFilename).toBeDefined();
      expect(typeof installModule.generateBackupFilename).toBe("function");
    });
  });

  describe("installers exports", () => {
    it("should export installToClient", () => {
      expect(installModule.installToClient).toBeDefined();
      expect(typeof installModule.installToClient).toBe("function");
    });

    it("should export installToClients", () => {
      expect(installModule.installToClients).toBeDefined();
      expect(typeof installModule.installToClients).toBe("function");
    });

    it("should export generateConfigPreview", () => {
      expect(installModule.generateConfigPreview).toBeDefined();
      expect(typeof installModule.generateConfigPreview).toBe("function");
    });

    it("should export individual installer functions", () => {
      expect(installModule.installClaudeDesktop).toBeDefined();
      expect(installModule.installClaudeCode).toBeDefined();
      expect(installModule.installCursor).toBeDefined();
      expect(installModule.installVSCodeCopilot).toBeDefined();
      expect(installModule.installWindsurf).toBeDefined();
      expect(installModule.installCline).toBeDefined();
      expect(installModule.installRooCode).toBeDefined();
    });
  });

  describe("install-command exports", () => {
    it("should export runInstallWizard", () => {
      expect(installModule.runInstallWizard).toBeDefined();
      expect(typeof installModule.runInstallWizard).toBe("function");
    });

    it("should export runInstallCommand", () => {
      expect(installModule.runInstallCommand).toBeDefined();
      expect(typeof installModule.runInstallCommand).toBe("function");
    });

    it("should export parseInstallFlags", () => {
      expect(installModule.parseInstallFlags).toBeDefined();
      expect(typeof installModule.parseInstallFlags).toBe("function");
    });

    it("should export buildServerConfigFromEnv", () => {
      expect(installModule.buildServerConfigFromEnv).toBeDefined();
      expect(typeof installModule.buildServerConfigFromEnv).toBe("function");
    });
  });
});
