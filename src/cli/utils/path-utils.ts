/**
 * Shared path utilities for CLI modules
 */

import { homedir } from "os";
import { join } from "path";

/**
 * Expand path with home directory (~/) and Windows environment variables (%VAR%)
 */
export function expandPath(path: string): string {
  let expanded = path;

  // Expand home directory
  if (expanded.startsWith("~/")) {
    expanded = join(homedir(), expanded.slice(2));
  }

  // Expand Windows environment variables
  if (process.platform === "win32") {
    expanded = expanded.replace(/%([^%]+)%/g, (_, varName: string) => {
      return process.env[varName] ?? "";
    });
  }

  return expanded;
}
