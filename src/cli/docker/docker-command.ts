/**
 * Docker subcommands for gitlab-mcp CLI
 */

import * as p from "@clack/prompts";
import { randomBytes } from "crypto";
import {
  getDockerStatus,
  startContainer,
  stopContainer,
  restartContainer,
  upgradeContainer,
  getLogs,
  tailLogs,
  addInstance,
  removeInstance,
  initDockerConfig,
  getExpandedConfigDir,
} from "./docker-utils";
import { GitLabInstance, DEFAULT_DOCKER_CONFIG } from "./types";

/**
 * Docker subcommand type
 */
export type DockerSubcommand =
  | "status"
  | "init"
  | "start"
  | "stop"
  | "restart"
  | "upgrade"
  | "logs"
  | "add-instance"
  | "remove-instance";

/**
 * Parse docker subcommand from CLI args
 */
export function parseDockerSubcommand(args: string[]): {
  subcommand: DockerSubcommand | undefined;
  subArgs: string[];
} {
  const subcommand = args[0] as DockerSubcommand | undefined;
  const subArgs = args.slice(1);

  const validSubcommands: DockerSubcommand[] = [
    "status",
    "init",
    "start",
    "stop",
    "restart",
    "upgrade",
    "logs",
    "add-instance",
    "remove-instance",
  ];

  if (subcommand && !validSubcommands.includes(subcommand)) {
    return { subcommand: undefined, subArgs: args };
  }

  return { subcommand, subArgs };
}

/**
 * Show Docker status
 */
export function showStatus(): void {
  const status = getDockerStatus();

  console.log("\nDocker Environment:");
  console.log(`  Docker installed: ${status.dockerInstalled ? "✓" : "✗"}`);

  if (!status.dockerInstalled) {
    console.log("\n⚠ Docker is not installed. Install Docker first.");
    console.log("  https://docs.docker.com/get-docker/");
    return;
  }

  console.log(`  Docker running: ${status.dockerRunning ? "✓" : "✗"}`);
  console.log(`  Compose installed: ${status.composeInstalled ? "✓" : "✗"}`);

  if (!status.dockerRunning) {
    console.log("\n⚠ Docker daemon is not running. Start Docker first.");
    return;
  }

  console.log("\nContainer Status:");
  if (status.container) {
    const c = status.container;
    console.log(`  Name: ${c.name}`);
    console.log(`  Status: ${c.status}${c.uptime ? ` (${c.uptime})` : ""}`);
    console.log(`  Image: ${c.image}`);
    if (c.ports.length > 0) {
      console.log(`  Ports: ${c.ports.join(", ")}`);
    }
  } else {
    console.log("  Container not found. Run 'gitlab-mcp docker init' to set up.");
  }

  console.log("\nConfigured Instances:");
  if (status.instances.length > 0) {
    for (const instance of status.instances) {
      console.log(`  ${instance.host}: ${instance.name}`);
      if (instance.oauth) {
        console.log(`    OAuth: enabled`);
      }
      if (instance.defaultPreset) {
        console.log(`    Preset: ${instance.defaultPreset}`);
      }
    }
  } else {
    console.log("  No instances configured.");
  }

  console.log(`\nConfig directory: ${getExpandedConfigDir()}`);
}

/**
 * Initialize Docker configuration interactively
 */
export async function initDocker(): Promise<void> {
  p.intro("Initialize GitLab MCP Docker Setup");

  // Check Docker prerequisites
  const status = getDockerStatus();

  if (!status.dockerInstalled) {
    p.log.error("Docker is not installed.");
    p.note("Visit https://docs.docker.com/get-docker/ to install Docker.", "Install Docker");
    p.outro("Setup cancelled.");
    return;
  }

  if (!status.composeInstalled) {
    p.log.error("Docker Compose is not installed.");
    p.note(
      "Docker Compose is required. Install it with:\n  docker compose version (v2, bundled with Docker Desktop)\n  or\n  pip install docker-compose (v1)",
      "Install Compose"
    );
    p.outro("Setup cancelled.");
    return;
  }

  // Port configuration
  const port = await p.text({
    message: "SSE port for MCP server:",
    placeholder: "3333",
    initialValue: "3333",
    validate: value => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 65535) {
        return "Port must be a number between 1 and 65535";
      }
      return undefined;
    },
  });

  if (p.isCancel(port)) {
    p.cancel("Setup cancelled");
    return;
  }

  // OAuth configuration
  const enableOAuth = await p.confirm({
    message: "Enable OAuth for multi-instance support?",
    initialValue: false,
  });

  if (p.isCancel(enableOAuth)) {
    p.cancel("Setup cancelled");
    return;
  }

  let oauthSessionSecret: string | undefined;

  if (enableOAuth) {
    p.note(
      "OAuth mode allows users to authenticate with multiple GitLab instances.\n" +
        "You'll need to register OAuth applications on each GitLab instance.",
      "OAuth Mode"
    );

    // Generate session secret
    oauthSessionSecret = randomBytes(32).toString("hex");
    p.log.info(`Generated session secret (stored in docker-compose.yml)`);
  }

  // Create configuration
  const config = {
    ...DEFAULT_DOCKER_CONFIG,
    port: parseInt(port, 10),
    oauthEnabled: enableOAuth,
    oauthSessionSecret,
  };

  const spinner = p.spinner();
  spinner.start("Creating Docker configuration...");

  try {
    initDockerConfig(config);
    spinner.stop("Docker configuration created!");

    p.log.success(`Config directory: ${getExpandedConfigDir()}`);

    // Ask to start container
    const startNow = await p.confirm({
      message: "Start the container now?",
      initialValue: true,
    });

    if (p.isCancel(startNow)) {
      p.cancel("Setup complete without starting container");
      return;
    }

    if (startNow) {
      spinner.start("Starting container...");
      const result = startContainer();
      if (result.success) {
        spinner.stop("Container started!");
      } else {
        spinner.stop("Failed to start container");
        p.log.error(result.error ?? "Unknown error");
      }
    }

    p.outro("Docker setup complete!");
  } catch (error) {
    spinner.stop("Configuration failed");
    p.log.error(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Start container
 */
export function dockerStart(): void {
  console.log("Starting gitlab-mcp container...");
  const result = startContainer();

  if (result.success) {
    console.log("✓ Container started");
    if (result.output) {
      console.log(result.output);
    }
  } else {
    console.error(`✗ Failed to start container: ${result.error}`);
  }
}

/**
 * Stop container
 */
export function dockerStop(): void {
  console.log("Stopping gitlab-mcp container...");
  const result = stopContainer();

  if (result.success) {
    console.log("✓ Container stopped");
  } else {
    console.error(`✗ Failed to stop container: ${result.error}`);
  }
}

/**
 * Restart container
 */
export function dockerRestart(): void {
  console.log("Restarting gitlab-mcp container...");
  const result = restartContainer();

  if (result.success) {
    console.log("✓ Container restarted");
  } else {
    console.error(`✗ Failed to restart container: ${result.error}`);
  }
}

/**
 * Upgrade container (pull + restart)
 */
export function dockerUpgrade(): void {
  console.log("Upgrading gitlab-mcp container...");
  const result = upgradeContainer();

  if (result.success) {
    console.log("✓ Container upgraded to latest version");
  } else {
    console.error(`✗ Failed to upgrade container: ${result.error}`);
  }
}

/**
 * Show container logs
 */
export function dockerLogs(follow: boolean = false, lines: number = 100): void {
  if (follow) {
    console.log(`Tailing logs (last ${lines} lines, Ctrl+C to exit)...\n`);
    const process = tailLogs(true, lines);

    process.on("error", error => {
      console.error(`Failed to get logs: ${error.message}`);
    });
  } else {
    const result = getLogs(lines);

    if (result.success) {
      console.log(result.output);
    } else {
      console.error(`Failed to get logs: ${result.error}`);
    }
  }
}

/**
 * Add GitLab instance interactively
 */
export async function dockerAddInstance(host?: string): Promise<void> {
  p.intro("Add GitLab Instance");

  // Get host
  let instanceHost: string;
  if (host) {
    instanceHost = host;
  } else {
    const hostInput = await p.text({
      message: "GitLab instance host:",
      placeholder: "gitlab.company.com",
      validate: value => {
        if (!value || value.length < 3) {
          return "Host is required";
        }
        // Basic hostname validation
        if (!/^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/i.test(value)) {
          return "Invalid hostname format";
        }
        return undefined;
      },
    });

    if (p.isCancel(hostInput)) {
      p.cancel("Setup cancelled");
      return;
    }

    instanceHost = hostInput;
  }

  // Get display name
  const name = await p.text({
    message: "Display name:",
    placeholder: "Company GitLab",
    initialValue: instanceHost,
  });

  if (p.isCancel(name)) {
    p.cancel("Setup cancelled");
    return;
  }

  // OAuth configuration
  const configureOAuth = await p.confirm({
    message: "Configure OAuth for this instance?",
    initialValue: false,
  });

  if (p.isCancel(configureOAuth)) {
    p.cancel("Setup cancelled");
    return;
  }

  let oauth: GitLabInstance["oauth"];

  if (configureOAuth) {
    const clientId = await p.text({
      message: "OAuth Application ID:",
      validate: value => {
        if (!value || value.length < 10) {
          return "Application ID is required";
        }
        return undefined;
      },
    });

    if (p.isCancel(clientId)) {
      p.cancel("Setup cancelled");
      return;
    }

    // Environment variable name for secret
    const envName = instanceHost.toUpperCase().replace(/\./g, "_") + "_SECRET";

    p.note(
      `Store your OAuth secret in environment variable: ${envName}\n` +
        `Add to docker-compose.yml environment section or use .env file.`,
      "OAuth Secret"
    );

    oauth = {
      clientId,
      clientSecretEnv: envName,
    };
  }

  // Default preset
  const preset = await p.select({
    message: "Default preset for this instance:",
    options: [
      { value: "developer", label: "Developer (default)" },
      { value: "senior-dev", label: "Senior Developer" },
      { value: "full-access", label: "Full Access" },
      { value: "devops", label: "DevOps" },
      { value: "code-reviewer", label: "Code Reviewer" },
      { value: "readonly", label: "Read-Only" },
    ],
  });

  if (p.isCancel(preset)) {
    p.cancel("Setup cancelled");
    return;
  }

  // Save instance
  const instance: GitLabInstance = {
    host: instanceHost,
    name,
    oauth,
    defaultPreset: preset,
  };

  addInstance(instance);

  p.log.success(`Added instance: ${instanceHost}`);
  p.outro("Instance configuration saved. Restart container to apply changes.");
}

/**
 * Remove GitLab instance
 */
export function dockerRemoveInstance(host: string): void {
  if (removeInstance(host)) {
    console.log(`✓ Removed instance: ${host}`);
    console.log("Restart container to apply changes.");
  } else {
    console.error(`✗ Instance not found: ${host}`);
  }
}

/**
 * Run docker subcommand
 */
export async function runDockerCommand(args: string[]): Promise<void> {
  const { subcommand, subArgs } = parseDockerSubcommand(args);

  switch (subcommand) {
    case "status":
      showStatus();
      break;

    case "init":
      await initDocker();
      break;

    case "start":
      dockerStart();
      break;

    case "stop":
      dockerStop();
      break;

    case "restart":
      dockerRestart();
      break;

    case "upgrade":
      dockerUpgrade();
      break;

    case "logs": {
      const follow = subArgs.includes("-f") || subArgs.includes("--follow");
      const linesArg = subArgs.find(a => a.startsWith("--lines="));
      const lines = linesArg ? parseInt(linesArg.split("=")[1], 10) : 100;
      dockerLogs(follow, lines);
      break;
    }

    case "add-instance":
      await dockerAddInstance(subArgs[0]);
      break;

    case "remove-instance":
      if (!subArgs[0]) {
        throw new Error("Usage: gitlab-mcp docker remove-instance <host>");
      }
      dockerRemoveInstance(subArgs[0]);
      break;

    default:
      console.log("GitLab MCP Docker Commands:\n");
      console.log("  gitlab-mcp docker status          Show container and instances status");
      console.log("  gitlab-mcp docker init            Initialize Docker configuration");
      console.log("  gitlab-mcp docker start           Start container");
      console.log("  gitlab-mcp docker stop            Stop container");
      console.log("  gitlab-mcp docker restart         Restart container");
      console.log("  gitlab-mcp docker upgrade         Pull latest image and restart");
      console.log("  gitlab-mcp docker logs [-f]       Show container logs");
      console.log("  gitlab-mcp docker add-instance    Add GitLab instance");
      console.log("  gitlab-mcp docker remove-instance Remove GitLab instance");
      break;
  }
}
