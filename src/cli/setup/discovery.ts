/**
 * Unified environment detection for the setup wizard.
 * Discovers installed MCP clients, Docker environment, and existing configurations.
 */

import { spawnSync } from "child_process";
import { detectAllClients } from "../install/detector";
import { DiscoveryResult } from "./types";
import { DockerStatusResult } from "../docker/types";

/**
 * Detect Docker environment status.
 * Uses lightweight subprocess calls to check Docker availability.
 */
function detectDocker(): DockerStatusResult {
  try {
    // Check if Docker is installed
    const dockerVersion = spawnSync("docker", ["--version"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    const dockerInstalled = dockerVersion.status === 0;

    if (!dockerInstalled) {
      return {
        dockerInstalled: false,
        dockerRunning: false,
        composeInstalled: false,
        instances: [],
      };
    }

    // Check if Docker daemon is running
    const dockerInfo = spawnSync("docker", ["info"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    const dockerRunning = dockerInfo.status === 0;

    // Check Docker Compose (v2: `docker compose`, fallback to v1: `docker-compose`)
    const composeV2 = spawnSync("docker", ["compose", "version"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    let composeInstalled = composeV2.status === 0;

    if (!composeInstalled) {
      const composeV1 = spawnSync("docker-compose", ["--version"], {
        stdio: "pipe",
        encoding: "utf8",
      });
      composeInstalled = composeV1.status === 0;
    }

    // Check for gitlab-mcp container
    let container: DockerStatusResult["container"];
    if (dockerRunning) {
      const containerCheck = spawnSync(
        "docker",
        [
          "ps",
          "-a",
          "--filter",
          "name=gitlab-mcp",
          "--format",
          "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}",
        ],
        { stdio: "pipe", encoding: "utf8" }
      );

      if (containerCheck.status === 0 && containerCheck.stdout.trim()) {
        const line = containerCheck.stdout.trim().split("\n")[0];
        const [id, name, image, status, ports] = line.split("|");
        const isRunning = status?.toLowerCase().startsWith("up");

        container = {
          id: id ?? "",
          name: name ?? "gitlab-mcp",
          image: image ?? "",
          status: isRunning ? "running" : "exited",
          ports: ports ? ports.split(",").map(p => p.trim()) : [],
          created: "",
        };
      }
    }

    return {
      dockerInstalled,
      dockerRunning,
      composeInstalled,
      container,
      instances: [],
    };
  } catch {
    // If child_process fails, return minimal result
    return {
      dockerInstalled: false,
      dockerRunning: false,
      composeInstalled: false,
      instances: [],
    };
  }
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
    if (result.docker.container) {
      const status = result.docker.container.status === "running" ? "running" : "stopped";
      parts.push(`Docker: container ${status}`);
    } else {
      parts.push("Docker: installed, no container");
    }
  }

  return parts.join(" | ");
}
