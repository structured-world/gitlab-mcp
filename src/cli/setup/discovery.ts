/**
 * Unified environment detection for the setup wizard.
 * Discovers installed MCP clients, Docker environment, and existing configurations.
 */

import { detectAllClients } from "../install/detector";
import { DiscoveryResult } from "./types";
import { DockerStatusResult } from "../docker/types";
import { getContainerRuntime } from "../docker/container-runtime";
import { getContainerInfo } from "../docker/docker-utils";

/**
 * Detect container runtime environment status.
 * Uses the shared container-runtime module for Docker/Podman detection.
 */
function detectDocker(): DockerStatusResult {
  const runtime = getContainerRuntime();

  return {
    dockerInstalled: runtime.runtimeVersion !== undefined,
    dockerRunning: runtime.runtimeAvailable,
    composeInstalled: runtime.composeCmd !== null,
    container: runtime.runtimeAvailable ? getContainerInfo() : undefined,
    instances: [],
    runtime,
  };
}

/**
 * Run full environment discovery.
 * Detects installed MCP clients, Docker status, and existing configurations.
 */
export function runDiscovery(): DiscoveryResult {
  // Detect MCP clients
  const allClients = detectAllClients();
  const detected = allClients.filter(r => r.detected);
  const configured = allClients.filter(r => r.alreadyConfigured);
  const unconfigured = detected.filter(r => !r.alreadyConfigured);

  // Detect Docker environment
  const docker = detectDocker();

  // Build summary
  const hasExistingSetup = configured.length > 0 || docker.container !== undefined;

  return {
    clients: {
      detected,
      configured,
      unconfigured,
    },
    docker,
    summary: {
      hasExistingSetup,
      clientCount: detected.length,
      configuredCount: configured.length,
      dockerRunning: docker.dockerRunning,
      containerExists: docker.container !== undefined,
    },
  };
}

/**
 * Format discovery summary for display
 */
export function formatDiscoverySummary(result: DiscoveryResult): string {
  const parts: string[] = [];

  if (result.summary.clientCount > 0) {
    const clientNames = result.clients.detected
      .map(c => {
        const configured = result.clients.configured.some(cc => cc.client === c.client);
        return configured ? `${c.client} ✓` : c.client;
      })
      .join(", ");
    parts.push(`Clients: ${clientNames}`);
  } else {
    parts.push("No MCP clients detected");
  }

  if (result.summary.configuredCount > 0) {
    parts.push(`Configured: ${result.summary.configuredCount} client(s)`);
  }

  if (result.docker.dockerInstalled) {
    const runtimeLabel = result.docker.runtime?.runtime === "podman" ? "Podman" : "Docker";
    if (result.docker.container) {
      const status = result.docker.container.status === "running" ? "running" : "stopped";
      parts.push(`${runtimeLabel}: container ${status}`);
    } else {
      parts.push(`${runtimeLabel}: installed, no container`);
    }
  }

  return parts.join(" | ");
}
