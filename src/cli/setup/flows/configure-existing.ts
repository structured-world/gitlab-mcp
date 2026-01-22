/**
 * Configure existing setup flow.
 * Allows users to update, add, or remove configurations for detected clients.
 */

import * as p from "@clack/prompts";
import { DiscoveryResult, SetupResult } from "../types";
import { InstallableClient, CLIENT_METADATA } from "../../install/types";
import { installToClients } from "../../install/installers";
import { buildServerConfigFromEnv } from "../../install/install-command";

/**
 * Run the configure-existing flow.
 * Shows detected clients with their status and offers actions.
 */
export async function runConfigureExistingFlow(discovery: DiscoveryResult): Promise<SetupResult> {
  const { detected, configured, unconfigured } = discovery.clients;

  // Show current status
  p.log.step("Current configuration:");

  for (const client of detected) {
    const metadata = CLIENT_METADATA[client.client];
    const status = client.alreadyConfigured ? "✓ configured" : "○ not configured";
    console.log(`  ${status}  ${metadata.name}`);
  }

  if (discovery.docker.container) {
    const containerStatus =
      discovery.docker.container.status === "running" ? "✓ running" : "○ stopped";
    console.log(`  ${containerStatus}  Docker container`);
  }

  console.log("");

  // Determine available actions
  const actionOptions: { value: string; label: string; hint?: string }[] = [];

  if (unconfigured.length > 0) {
    actionOptions.push({
      value: "add-clients",
      label: `Add gitlab-mcp to ${unconfigured.length} unconfigured client(s)`,
      hint: unconfigured.map(c => CLIENT_METADATA[c.client].name).join(", "),
    });
  }

  if (configured.length > 0) {
    actionOptions.push({
      value: "update-clients",
      label: `Update ${configured.length} existing configuration(s)`,
      hint: configured.map(c => CLIENT_METADATA[c.client].name).join(", "),
    });
  }

  if (discovery.docker.container) {
    if (discovery.docker.container.status === "running") {
      actionOptions.push({
        value: "restart-docker",
        label: "Restart Docker container",
      });
    } else {
      actionOptions.push({
        value: "start-docker",
        label: "Start Docker container",
      });
    }
  }

  actionOptions.push({
    value: "cancel",
    label: "Cancel",
  });

  const action = await p.select({
    message: "What would you like to do?",
    options: actionOptions,
  });

  if (p.isCancel(action) || action === "cancel") {
    return { success: false, mode: "configure-existing", error: "Cancelled" };
  }

  switch (action) {
    case "add-clients":
      return addToClients(unconfigured.map(c => c.client));

    case "update-clients":
      return updateClients(configured.map(c => c.client));

    case "restart-docker":
    case "start-docker": {
      const { startContainer, restartContainer } = await import("../../docker/docker-utils");
      const spinner = p.spinner();
      spinner.start(action === "restart-docker" ? "Restarting..." : "Starting...");
      const result = action === "restart-docker" ? restartContainer() : startContainer();
      if (result.success) {
        spinner.stop("Done!");
      } else {
        spinner.stop("Failed");
        p.log.error(result.error ?? "Unknown error");
      }
      return { success: result.success, mode: "configure-existing" };
    }

    default:
      return { success: false, mode: "configure-existing", error: "Unknown action" };
  }
}

/**
 * Add gitlab-mcp configuration to unconfigured clients
 */
async function addToClients(clients: InstallableClient[]): Promise<SetupResult> {
  // Select which clients to configure
  const selectedClients = await p.multiselect({
    message: "Select clients to add gitlab-mcp to:",
    options: clients.map(client => ({
      value: client,
      label: CLIENT_METADATA[client].name,
    })),
    required: true,
  });

  if (p.isCancel(selectedClients)) {
    return { success: false, mode: "configure-existing", error: "Cancelled" };
  }

  const targetClients = selectedClients;

  // Build server config from current environment
  const serverConfig = buildServerConfigFromEnv();

  if (!serverConfig.env.GITLAB_TOKEN) {
    // Need to get a token
    const token = await p.password({
      message: "Enter GitLab Personal Access Token:",
      validate: v => (!v || v.length < 10 ? "Token is too short" : undefined),
    });

    if (p.isCancel(token)) {
      return { success: false, mode: "configure-existing", error: "Cancelled" };
    }
    serverConfig.env.GITLAB_TOKEN = token;
  }

  const spinner = p.spinner();
  spinner.start("Installing configuration...");
  const results = installToClients(targetClients, serverConfig, false);
  spinner.stop("Done!");

  const successful = results.filter(r => r.success);
  if (successful.length > 0) {
    p.log.success(`Added to ${successful.length} client(s)`);
  }

  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    for (const r of failed) {
      p.log.error(`  ${CLIENT_METADATA[r.client].name}: ${r.error}`);
    }
  }

  return {
    success: successful.length > 0,
    mode: "configure-existing",
    configuredClients: successful.map(r => r.client),
  };
}

/**
 * Update existing client configurations
 */
async function updateClients(clients: InstallableClient[]): Promise<SetupResult> {
  const selectedClients = await p.multiselect({
    message: "Select clients to update:",
    options: clients.map(client => ({
      value: client,
      label: CLIENT_METADATA[client].name,
    })),
    required: true,
  });

  if (p.isCancel(selectedClients)) {
    return { success: false, mode: "configure-existing", error: "Cancelled" };
  }

  const targetClients = selectedClients;

  // Build server config from current environment
  const serverConfig = buildServerConfigFromEnv();

  if (!serverConfig.env.GITLAB_TOKEN) {
    const token = await p.password({
      message: "Enter GitLab Personal Access Token:",
      validate: v => (!v || v.length < 10 ? "Token is too short" : undefined),
    });

    if (p.isCancel(token)) {
      return { success: false, mode: "configure-existing", error: "Cancelled" };
    }
    serverConfig.env.GITLAB_TOKEN = token;
  }

  const spinner = p.spinner();
  spinner.start("Updating configuration...");
  const results = installToClients(targetClients, serverConfig, true);
  spinner.stop("Done!");

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length > 0) {
    p.log.success(`Updated ${successful.length} client(s)`);
  }

  if (failed.length > 0) {
    for (const r of failed) {
      p.log.error(`  ${CLIENT_METADATA[r.client].name}: ${r.error}`);
    }
  }

  return {
    success: successful.length > 0,
    mode: "configure-existing",
    configuredClients: successful.map(r => r.client),
    error: failed.length > 0 ? `Failed to update ${failed.length} client(s)` : undefined,
  };
}
