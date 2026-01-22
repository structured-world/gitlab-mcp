/**
 * Backup utility for MCP client configurations
 * Creates timestamped backups before modifying config files
 */

import { existsSync, copyFileSync, mkdirSync } from "fs";
import { dirname, basename, join } from "path";
import { BackupOptions, BackupResult } from "./types";

/**
 * Generate backup filename with timestamp
 */
export function generateBackupFilename(originalPath: string): string {
  const dir = dirname(originalPath);
  const name = basename(originalPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, `${name}.backup-${timestamp}`);
}

/**
 * Create a backup of a config file
 */
export function createBackup(options: BackupOptions): BackupResult {
  const { configPath, backupDir } = options;

  // Check if source file exists
  if (!existsSync(configPath)) {
    return {
      created: false,
      error: "Config file does not exist, no backup needed",
    };
  }

  try {
    // Determine backup path
    let backupPath: string;
    if (backupDir) {
      // Ensure backup directory exists
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = join(backupDir, `${basename(configPath)}.backup-${timestamp}`);
    } else {
      backupPath = generateBackupFilename(configPath);
    }

    // Copy file to backup location
    copyFileSync(configPath, backupPath);

    return {
      created: true,
      backupPath,
    };
  } catch (error) {
    return {
      created: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Restore a backup file
 */
export function restoreBackup(backupPath: string, targetPath: string): boolean {
  try {
    if (!existsSync(backupPath)) {
      return false;
    }

    // Ensure target directory exists
    const targetDir = dirname(targetPath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    copyFileSync(backupPath, targetPath);
    return true;
  } catch {
    return false;
  }
}
