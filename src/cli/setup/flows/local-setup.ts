/**
 * Local (stdio) setup flow.
 * Handles GitLab authentication, tool configuration, and client installation.
 */

import * as p from "@clack/prompts";
import { DiscoveryResult, SetupResult, ToolConfig } from "../types";
import { InstallableClient, CLIENT_METADATA } from "../../install/types";
import { testConnection, validateGitLabUrl, getPatCreationUrl } from "../../init/connection";
import { openUrl } from "../../init/browser";
import { McpServerConfig } from "../../init/types";
import { installToClients } from "../../install/installers";
import { runToolSelectionFlow } from "./tool-selection";

/**
 * Run the local (stdio) setup flow.
 * Guides user through GitLab connection, tool selection, and client installation.
 */
export async function runLocalSetupFlow(discovery: DiscoveryResult): Promise<SetupResult> {
  // Step 1: GitLab instance selection
  const instanceType = await p.select({
    message: "Which GitLab instance?",
    options: [
      { value: "saas" as const, label: "GitLab.com (SaaS)" },
      { value: "self-hosted" as const, label: "Self-hosted GitLab" },
    ],
  });

  if (p.isCancel(instanceType)) {
    return { success: false, mode: "local", error: "Cancelled" };
  }

  let instanceUrl: string;
  if (instanceType === "saas") {
    instanceUrl = "https://gitlab.com";
  } else {
    const urlInput = await p.text({
      message: "Enter your GitLab instance URL:",
      placeholder: "https://gitlab.example.com",
      validate: value => {
        const result = validateGitLabUrl(value ?? "");
        return result.valid ? undefined : result.error;
      },
    });

    if (p.isCancel(urlInput)) {
      return { success: false, mode: "local", error: "Cancelled" };
    }
    instanceUrl = urlInput.replace(/\/+$/, "").replace(/\/api\/v4$/i, "");
  }

  // Step 2: Authentication
  const hasToken = await p.confirm({
    message: "Do you already have a GitLab Personal Access Token (PAT)?",
    initialValue: false,
  });

  if (p.isCancel(hasToken)) {
    return { success: false, mode: "local", error: "Cancelled" };
  }

  if (!hasToken) {
    const patUrl = getPatCreationUrl(instanceUrl);
    p.note(
      `You need a Personal Access Token with these scopes:\n` +
        `  - api (full API access)\n` +
        `  - read_user (read user info)\n\n` +
        `Token URL: ${patUrl}`,
      "Create a Personal Access Token"
    );

    const openBrowser = await p.confirm({
      message: "Open browser to create token?",
      initialValue: true,
    });

    if (!p.isCancel(openBrowser) && openBrowser) {
      const opened = await openUrl(patUrl);
      if (opened) {
        p.log.info("Browser opened. Create your token and copy it.");
      } else {
        p.log.warn("Could not open browser automatically");
        p.note(patUrl, "Open this URL manually:");
      }
    }
  }

  // Step 3: Enter token
  const tokenInput = await p.password({
    message: "Enter your Personal Access Token:",
    validate: value => {
      if (!value || value.length < 10) {
        return "Token is too short";
      }
      return undefined;
    },
  });

  if (p.isCancel(tokenInput)) {
    return { success: false, mode: "local", error: "Cancelled" };
  }

  const token = tokenInput;

  // Step 4: Test connection
  const spinner = p.spinner();
  spinner.start("Testing connection...");

  const connectionResult = await testConnection(instanceUrl, token);

  if (!connectionResult.success) {
    spinner.stop("Connection failed");
    p.log.error(`Connection error: ${connectionResult.error ?? "Unknown error"}`);
    return { success: false, mode: "local", error: connectionResult.error };
  }

  spinner.stop("Connection successful!");
  p.log.success(
    `Connected as ${connectionResult.username ?? "unknown user"}` +
      (connectionResult.gitlabVersion ? ` (GitLab ${connectionResult.gitlabVersion})` : "")
  );

  // Step 5: Tool configuration
  const toolConfig = await runToolSelectionFlow();

  if (!toolConfig) {
    return { success: false, mode: "local", error: "Cancelled" };
  }

  // Step 6: Build server configuration
  const serverConfig = buildServerConfig(instanceUrl, token, toolConfig);

  // Step 7: Select clients to install
  const targetClients = await selectClients(discovery);

  if (!targetClients || targetClients.length === 0) {
    // No clients selected - just show the config
    p.log.step("Generated configuration:");
    const configJson = JSON.stringify({ mcpServers: { gitlab: serverConfig } }, null, 2);
    // Mask token in display
    const masked = configJson.replace(/("GITLAB_TOKEN"\s*:\s*")((?:\\.|[^"\\])*)(")/g, "$1****$3");
    p.note(masked, "MCP Server Configuration");
    p.log.warn("Replace **** with your actual token in the config file.");
    return { success: true, mode: "local" };
  }

  // Step 8: Install to clients
  spinner.start("Installing configuration...");
  const results = installToClients(targetClients, serverConfig, true);
  spinner.stop("Installation complete!");

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length > 0) {
    p.log.success(`Installed to ${successful.length} client(s):`);
    for (const result of successful) {
      const metadata = CLIENT_METADATA[result.client];
      let info = `  ✓ ${metadata.name}`;
      if (result.configPath) info += ` (${result.configPath})`;
      console.log(info);
    }
  }

  if (failed.length > 0) {
    p.log.error(`Failed for ${failed.length} client(s):`);
    for (const result of failed) {
      const metadata = CLIENT_METADATA[result.client];
      console.log(`  ✗ ${metadata.name}: ${result.error}`);
    }
  }

  return {
    success: successful.length > 0,
    mode: "local",
    configuredClients: successful.map(r => r.client),
  };
}

/**
 * Build McpServerConfig from wizard inputs
 */
function buildServerConfig(
  instanceUrl: string,
  token: string,
  toolConfig: ToolConfig
): McpServerConfig {
  const env: Record<string, string> = {
    GITLAB_URL: instanceUrl,
    GITLAB_TOKEN: token,
  };

  // Apply tool configuration
  if (toolConfig.mode === "preset" && toolConfig.preset) {
    env.GITLAB_MCP_PRESET = toolConfig.preset;
  }

  if (toolConfig.mode === "advanced" && toolConfig.envOverrides) {
    Object.assign(env, toolConfig.envOverrides);
  }

  return {
    command: "npx",
    args: ["-y", "@structured-world/gitlab-mcp@latest"],
    env,
  };
}

/**
 * Select clients for installation from detected clients
 */
async function selectClients(discovery: DiscoveryResult): Promise<InstallableClient[] | null> {
  const detected = discovery.clients.detected;

  if (detected.length === 0) {
    p.log.warn("No MCP clients detected. Configuration will be displayed instead.");
    return null;
  }

  const selectedClients = await p.multiselect({
    message: "Select clients to install to:",
    options: detected.map(result => ({
      value: result.client,
      label: CLIENT_METADATA[result.client].name,
      hint: result.alreadyConfigured ? "already configured (will overwrite)" : undefined,
    })),
    required: false,
  });

  if (p.isCancel(selectedClients)) {
    return null;
  }

  return selectedClients;
}
