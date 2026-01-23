/**
 * Server (HTTP/SSE) setup flow.
 * Handles Docker-based deployment configuration.
 */

import * as p from "@clack/prompts";
import { randomBytes } from "crypto";
import { DiscoveryResult, SetupResult, DockerDeploymentType } from "../types";
import { initDockerConfig, startContainer } from "../../docker/docker-utils";
import { getContainerRuntime } from "../../docker/container-runtime";
import { DEFAULT_DOCKER_CONFIG } from "../../docker/types";
import { runToolSelectionFlow, applyManualCategories } from "./tool-selection";

/**
 * Run the server (HTTP/SSE) setup flow.
 * Guides user through Docker deployment configuration.
 */
export async function runServerSetupFlow(discovery: DiscoveryResult): Promise<SetupResult> {
  // Check container runtime prerequisites
  const status = discovery.docker;
  const runtime = getContainerRuntime();
  const runtimeLabel = runtime.runtime === "podman" ? "Podman" : "Docker";

  if (!status.dockerInstalled) {
    p.log.error("No container runtime (Docker or Podman) is installed.");
    p.note(
      "Install Docker: https://docs.docker.com/get-docker/\nOr Podman: https://podman.io/getting-started/installation",
      "Install Runtime"
    );
    return { success: false, mode: "server", error: "Container runtime not installed" };
  }

  if (!status.composeInstalled) {
    p.log.error(`No compose tool found for ${runtimeLabel}.`);
    p.note(
      `A compose tool is required.\nFor Docker: bundled with Docker Desktop or 'docker compose'\nFor Podman: install podman-compose`,
      "Install Compose"
    );
    return { success: false, mode: "server", error: "Compose tool not installed" };
  }

  // Step 1: Deployment type
  const deploymentType = await p.select<DockerDeploymentType>({
    message: "Deployment type:",
    options: [
      {
        value: "standalone" as DockerDeploymentType,
        label: "Docker standalone",
        hint: "Stateless, for dev/testing",
      },
      {
        value: "external-db" as DockerDeploymentType,
        label: "Docker + external PostgreSQL",
        hint: "Production with existing database",
      },
      {
        value: "compose-bundle" as DockerDeploymentType,
        label: "Docker Compose bundle",
        hint: "All-in-one with postgres included",
      },
    ],
  });

  if (p.isCancel(deploymentType)) {
    return { success: false, mode: "server", error: "Cancelled" };
  }

  // Step 2: Port configuration
  const port = await p.text({
    message: "SSE port for MCP server:",
    placeholder: "3333",
    initialValue: "3333",
    validate: value => {
      const num = parseInt(value ?? "", 10);
      if (isNaN(num) || num < 1 || num > 65535) {
        return "Port must be between 1 and 65535";
      }
      return undefined;
    },
  });

  if (p.isCancel(port)) {
    return { success: false, mode: "server", error: "Cancelled" };
  }

  // Step 3: OAuth configuration
  const enableOAuth = await p.confirm({
    message: "Enable OAuth for multi-user support?",
    initialValue: deploymentType !== "standalone",
  });

  if (p.isCancel(enableOAuth)) {
    return { success: false, mode: "server", error: "Cancelled" };
  }

  let oauthSessionSecret: string | undefined;
  let databaseUrl: string | undefined;

  if (enableOAuth) {
    oauthSessionSecret = randomBytes(32).toString("hex");
    p.log.info("Session secret generated and stored in .env file (not in compose).");

    if (deploymentType === "external-db") {
      const dbUrl = await p.text({
        message: "PostgreSQL DATABASE_URL:",
        placeholder: "postgresql://user:pass@host:5432/gitlab_mcp",
        validate: v => {
          if (!v?.startsWith("postgresql://")) {
            return "Must be a valid PostgreSQL URL";
          }
          return undefined;
        },
      });

      if (p.isCancel(dbUrl)) {
        return { success: false, mode: "server", error: "Cancelled" };
      }
      databaseUrl = dbUrl;
    }
  }

  // Step 4: Tool configuration
  const toolConfig = await runToolSelectionFlow();

  if (!toolConfig) {
    return { success: false, mode: "server", error: "Cancelled" };
  }

  // Step 5: Create Docker configuration with tool selection and deployment type applied
  const toolEnv: Record<string, string> = {};
  if (toolConfig.mode === "preset" && toolConfig.preset) {
    toolEnv.GITLAB_PROFILE = toolConfig.preset;
  } else if (toolConfig.mode === "advanced" && toolConfig.envOverrides) {
    Object.assign(toolEnv, toolConfig.envOverrides);
  } else if (toolConfig.mode === "manual" && toolConfig.enabledCategories) {
    applyManualCategories(toolConfig.enabledCategories, toolEnv);
  }

  const config = {
    ...DEFAULT_DOCKER_CONFIG,
    port: parseInt(port, 10),
    deploymentType,
    oauthEnabled: enableOAuth,
    oauthSessionSecret,
    databaseUrl,
    environment: Object.keys(toolEnv).length > 0 ? toolEnv : undefined,
  };

  const spinner = p.spinner();
  spinner.start("Creating Docker configuration...");

  try {
    initDockerConfig(config);
    spinner.stop("Docker configuration created!");

    // Step 6: Start container
    const startNow = await p.confirm({
      message: "Start the container now?",
      initialValue: true,
    });

    if (!p.isCancel(startNow) && startNow) {
      spinner.start("Starting container...");
      const result = startContainer();
      if (result.success) {
        spinner.stop("Container started!");
        p.log.success(`MCP server running at http://localhost:${port}`);
      } else {
        spinner.stop("Failed to start container");
        p.log.error(result.error ?? "Unknown error");
      }
    }

    return {
      success: true,
      mode: "server",
      dockerConfig: {
        port: parseInt(port, 10),
        deploymentType,
        instances: [],
      },
    };
  } catch (error) {
    spinner.stop("Configuration failed");
    const msg = error instanceof Error ? error.message : String(error);
    p.log.error(msg);
    return { success: false, mode: "server", error: msg };
  }
}
