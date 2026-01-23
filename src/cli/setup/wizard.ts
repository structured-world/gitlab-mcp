/**
 * Main unified setup wizard orchestration.
 * Entry point for `gitlab-mcp setup` command.
 */

import * as p from "@clack/prompts";
import { SetupMode, SetupResult } from "./types";
import { runDiscovery, formatDiscoverySummary } from "./discovery";
import { runLocalSetupFlow } from "./flows/local-setup";
import { runServerSetupFlow } from "./flows/server-setup";
import { runConfigureExistingFlow } from "./flows/configure-existing";

/**
 * Run the unified setup wizard.
 * Performs environment discovery, then presents mode selection based on results.
 */
export async function runSetupWizard(options?: {
  /** Skip to specific mode (for alias commands) */
  mode?: SetupMode;
}): Promise<SetupResult> {
  p.intro("GitLab MCP Setup Wizard");

  // Phase 1: Discovery
  const spinner = p.spinner();
  spinner.start("Detecting environment...");

  const discovery = runDiscovery();

  spinner.stop("Environment detected");

  // Display discovery summary
  const summary = formatDiscoverySummary(discovery);
  p.log.info(summary);

  // Phase 2: Mode selection
  let mode: SetupMode;

  if (options?.mode) {
    // Mode specified via alias (init → local, docker init → server)
    mode = options.mode;
  } else {
    const selected = await selectMode(discovery);
    if (!selected) {
      p.outro("Setup cancelled.");
      return { success: false, error: "Cancelled" };
    }
    mode = selected;
  }

  // Phase 3: Execute selected flow
  let result: SetupResult;

  switch (mode) {
    case "configure-existing":
      result = await runConfigureExistingFlow(discovery);
      break;

    case "local":
      result = await runLocalSetupFlow(discovery);
      break;

    case "server":
      result = await runServerSetupFlow(discovery);
      break;
  }

  // Phase 4: Summary
  if (result.success) {
    const parts: string[] = ["Setup complete!"];

    if (result.configuredClients && result.configuredClients.length > 0) {
      parts.push(`Configured ${result.configuredClients.length} client(s).`);
      parts.push("Restart your MCP clients to apply changes.");
    }

    if (result.dockerConfig) {
      parts.push(`Docker container on port ${result.dockerConfig.port}.`);
    }

    p.outro(parts.join(" "));
  } else if (result.error !== "Cancelled") {
    p.outro(`Setup failed: ${result.error ?? "Unknown error"}`);
  } else {
    p.outro("Setup cancelled.");
  }

  return result;
}

/**
 * Present mode selection based on discovery results
 */
async function selectMode(discovery: ReturnType<typeof runDiscovery>): Promise<SetupMode | null> {
  const options: { value: SetupMode; label: string; hint?: string }[] = [];

  // If existing setup found, show configure-existing first
  if (discovery.summary.hasExistingSetup) {
    const parts: string[] = [];
    if (discovery.summary.configuredCount > 0) {
      parts.push(`${discovery.summary.configuredCount} client(s)`);
    }
    if (discovery.summary.containerExists) {
      parts.push("1 docker service");
    }

    options.push({
      value: "configure-existing",
      label: "Configure existing",
      hint: parts.join(", "),
    });
  }

  options.push({
    value: "local",
    label: "New local setup (stdio)",
    hint: "For AI IDE clients (Claude, Cursor, VS Code, etc.)",
  });

  options.push({
    value: "server",
    label: "New server setup (HTTP/SSE)",
    hint: "Docker-based for shared/team access",
  });

  const mode = await p.select({
    message: "What would you like to do?",
    options,
  });

  if (p.isCancel(mode)) {
    return null;
  }

  return mode;
}
