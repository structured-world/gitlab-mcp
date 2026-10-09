/**
 * Container runtime detection module.
 * Detects Docker or Podman and their compose variants, caching the result per process.
 */

import { spawnSync } from 'child_process';
import { ContainerRuntime, ContainerRuntimeInfo } from './types';

/** Module-level cached runtime info */
let cachedRuntime: ContainerRuntimeInfo | null = null;

/**
 * Try running a command and return true if it exits 0.
 */
function commandSucceeds(cmd: string, args: string[]): boolean {
  try {
    const result = spawnSync(cmd, args, {
      stdio: 'pipe',
      encoding: 'utf8',
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
      stdio: 'pipe',
      encoding: 'utf8',
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

interface ComposeDetection {
  cmd: string[];
  provider?: 'docker-compose' | 'podman-compose';
  version?: string;
}

/** Implementation and version from a compose version banner. */
function describeCompose(cmd: string[], output: string | undefined): ComposeDetection {
  if (!output) return { cmd };
  return {
    cmd,
    // `podman compose` delegates to docker-compose or podman-compose; the banner names it.
    provider: /podman-compose/i.test(output) ? 'podman-compose' : 'docker-compose',
    version: parseVersion(output),
  };
}

/**
 * Detect the compose command for a given runtime.
 * Priority for docker: docker compose → docker-compose
 * Priority for podman: podman compose → podman-compose → docker-compose (fallback)
 */
function detectComposeCmd(runtime: ContainerRuntime): ComposeDetection | null {
  const runtimeCmd = runtime;

  // Try "<runtime> compose version" (compose v2 plugin)
  if (commandSucceeds(runtimeCmd, ['compose', 'version'])) {
    const cmd = [runtimeCmd, 'compose'];
    return describeCompose(cmd, commandOutput(runtimeCmd, ['compose', 'version']));
  }

  // Try "<runtime>-compose --version" (standalone compose)
  const standaloneCompose = `${runtimeCmd}-compose`;
  if (commandSucceeds(standaloneCompose, ['--version'])) {
    return describeCompose([standaloneCompose], commandOutput(standaloneCompose, ['--version']));
  }

  // Cross-runtime fallback: try docker-compose as last resort
  if (commandSucceeds('docker-compose', ['--version'])) {
    return describeCompose(['docker-compose'], commandOutput('docker-compose', ['--version']));
  }

  return null;
}

/** Whether dotted version `actual` is at least `minimum`. */
function versionAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split('.').map(Number);
  const m = minimum.split('.').map(Number);
  for (let i = 0; i < m.length; i++) {
    if ((a[i] ?? 0) !== m[i]) return (a[i] ?? 0) > m[i];
  }
  return true;
}

/**
 * Why the detected compose cannot run deployments that start the server after a
 * one-shot migration (`depends_on` with `condition: service_completed_successfully`),
 * or undefined when it can. Docker Compose implements the condition from v2,
 * podman-compose from 1.6.0.
 */
export function completionDependencyError(info: ContainerRuntimeInfo): string | undefined {
  const required = 'Docker Compose v2 or podman-compose 1.6.0 or later';
  if (!info.composeCmd || !info.composeVersion) {
    return `Could not determine the compose version; PostgreSQL deployments need ${required}.`;
  }
  const minimum = info.composeProvider === 'podman-compose' ? '1.6.0' : '2.0.0';
  if (versionAtLeast(info.composeVersion, minimum)) return undefined;
  return `${info.composeProvider} ${info.composeVersion} cannot order the database migration before the server; install ${required}.`;
}

/**
 * Perform full container runtime detection.
 * Priority: docker > podman.
 * Checks runtime availability, daemon status, and compose command.
 */
export function detectContainerRuntime(): ContainerRuntimeInfo {
  const runtimes: ContainerRuntime[] = ['docker', 'podman'];

  for (const runtime of runtimes) {
    const versionOutput = commandOutput(runtime, ['--version']);
    if (versionOutput) {
      // Runtime binary exists, check if daemon is accessible
      const runtimeAvailable = commandSucceeds(runtime, ['info']);
      const compose = detectComposeCmd(runtime);
      const runtimeVersion = parseVersion(versionOutput);

      return {
        runtime,
        runtimeCmd: runtime,
        runtimeAvailable,
        composeCmd: compose?.cmd ?? null,
        ...(compose?.provider && { composeProvider: compose.provider }),
        ...(compose?.version && { composeVersion: compose.version }),
        runtimeVersion,
      };
    }
  }

  // No runtime found at all
  return {
    runtime: 'docker',
    runtimeCmd: 'docker',
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
