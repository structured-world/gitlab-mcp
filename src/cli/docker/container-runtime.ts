/**
 * Container runtime detection module.
 * Detects Docker or Podman and their compose variants, caching the result per process.
 */

import { spawnSync } from "child_process";
import { ContainerRuntime, ContainerRuntimeInfo } from "./types";

/** Module-level cached runtime info */
let cachedRuntime: ContainerRuntimeInfo | null = null;

/**
 * Try running a command and return true if it exits 0.
 */
function commandSucceeds(cmd: string, args: string[]): boolean {
  try {
    const result = spawnSync(cmd, args, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Try running a command and return its stdout if it exits 0, otherwise undefined.
 */
function commandOutput(cmd: string, args: string[]): string | undefined {
  try {
    const result = spawnSync(cmd, args, {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract version string from runtime --version output.
 * e.g. "Docker version 24.0.7, build afdd53b" → "24.0.7"
 *      "podman version 4.9.3" → "4.9.3"
 */
function parseVersion(output: string): string | undefined {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match?.[1];
}

/**
 * Detect the compose command for a given runtime.
 * Priority for docker: docker compose → docker-compose
 * Priority for podman: podman compose → podman-compose → docker-compose (fallback)
 */
function detectComposeCmd(runtime: ContainerRuntime): string[] | null {
  const runtimeCmd = runtime;

  // Try "<runtime> compose version" (compose v2 plugin)
  if (commandSucceeds(runtimeCmd, ["compose", "version"])) {
    return [runtimeCmd, "compose"];
  }

  // Try "<runtime>-compose --version" (standalone compose)
  const standaloneCompose = `${runtimeCmd}-compose`;
  if (commandSucceeds(standaloneCompose, ["--version"])) {
    return [standaloneCompose];
  }

  // Cross-runtime fallback: try docker-compose as last resort
  if (commandSucceeds("docker-compose", ["--version"])) {
    return ["docker-compose"];
  }

  return null;
}

/**
 * Perform full container runtime detection.
 * Priority: docker > podman.
 * Checks runtime availability, daemon status, and compose command.
 */
export function detectContainerRuntime(): ContainerRuntimeInfo {
  const runtimes: ContainerRuntime[] = ["docker", "podman"];

  for (const runtime of runtimes) {
    const versionOutput = commandOutput(runtime, ["--version"]);
    if (versionOutput) {
      // Runtime binary exists, check if daemon is accessible
      const runtimeAvailable = commandSucceeds(runtime, ["info"]);
      const composeCmd = detectComposeCmd(runtime);
      const runtimeVersion = parseVersion(versionOutput);

      return {
        runtime,
        runtimeCmd: runtime,
        runtimeAvailable,
        composeCmd,
        runtimeVersion,
      };
    }
  }

  // No runtime found at all
  return {
    runtime: "docker",
    runtimeCmd: "docker",
    runtimeAvailable: false,
    composeCmd: null,
    runtimeVersion: undefined,
  };
}

/**
 * Get cached container runtime info.
 * Detects once per process and caches the result.
 */
export function getContainerRuntime(): ContainerRuntimeInfo {
  cachedRuntime ??= detectContainerRuntime();
  return cachedRuntime;
}

/**
 * Reset the runtime cache. Used in tests to allow re-detection.
 */
export function resetRuntimeCache(): void {
  cachedRuntime = null;
}
