/**
 * Unit tests for install/backup.ts
 * Tests backup functionality for MCP client configurations
 */

import {
  generateBackupFilename,
  createBackup,
  restoreBackup,
} from "../../../../src/cli/install/backup";
import * as fs from "fs";

// Mock fs module
jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

describe("install backup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("generateBackupFilename", () => {
    it("should generate backup filename with timestamp", () => {
      const result = generateBackupFilename("/path/to/config.json");

      // Should be in same directory
      expect(result).toContain("/path/to/");
      // Should contain original filename
      expect(result).toContain("config.json");
      // Should contain .backup-
      expect(result).toContain(".backup-");
    });

    it("should handle files without extension", () => {
      const result = generateBackupFilename("/path/to/config");

      expect(result).toContain("/path/to/");
      expect(result).toContain("config");
      expect(result).toContain(".backup-");
    });
  });

  describe("createBackup", () => {
    it("should return created=false if file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = createBackup({ configPath: "/path/to/config.json" });

      expect(result.created).toBe(false);
      expect(result.error).toContain("does not exist");
    });

    it("should create backup in same directory by default", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.copyFileSync.mockImplementation(() => undefined);

      const result = createBackup({ configPath: "/path/to/config.json" });

      expect(result.created).toBe(true);
      expect(result.backupPath).toContain("/path/to/");
      expect(result.backupPath).toContain(".backup-");
      expect(mockFs.copyFileSync).toHaveBeenCalled();
    });

    it("should create backup directory if specified and not exists", () => {
      mockFs.existsSync
        .mockReturnValueOnce(true) // config file exists
        .mockReturnValueOnce(false); // backup dir does not exist
      mockFs.copyFileSync.mockImplementation(() => undefined);
      mockFs.mkdirSync.mockImplementation(() => undefined);

      const result = createBackup({
        configPath: "/path/to/config.json",
        backupDir: "/backup/dir",
      });

      expect(result.created).toBe(true);
      expect(result.backupPath).toContain("/backup/dir/");
      expect(mockFs.mkdirSync).toHaveBeenCalledWith("/backup/dir", { recursive: true });
    });

    it("should return error on copy failure", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.copyFileSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = createBackup({ configPath: "/path/to/config.json" });

      expect(result.created).toBe(false);
      expect(result.error).toContain("Permission denied");
    });
  });

  describe("restoreBackup", () => {
    it("should return false if backup file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = restoreBackup("/backup/path", "/target/path");

      expect(result).toBe(false);
    });

    it("should create target directory if not exists", () => {
      mockFs.existsSync
        .mockReturnValueOnce(true) // backup exists
        .mockReturnValueOnce(false); // target dir does not exist
      mockFs.copyFileSync.mockImplementation(() => undefined);
      mockFs.mkdirSync.mockImplementation(() => undefined);

      const result = restoreBackup("/backup/file.json", "/new/target/config.json");

      expect(result).toBe(true);
      expect(mockFs.mkdirSync).toHaveBeenCalledWith("/new/target", { recursive: true });
      expect(mockFs.copyFileSync).toHaveBeenCalledWith(
        "/backup/file.json",
        "/new/target/config.json"
      );
    });

    it("should return false on copy failure", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.copyFileSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = restoreBackup("/backup/file.json", "/target/config.json");

      expect(result).toBe(false);
    });
  });
});
