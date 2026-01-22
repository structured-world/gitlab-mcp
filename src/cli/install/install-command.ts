/**
 * Interactive install wizard for MCP clients
 */

import * as p from "@clack/prompts";
import {
  InstallableClient,
  InstallResult,
  CLIENT_METADATA,
  INSTALLABLE_CLIENTS,
  ClientDetectionResult,
} from "./types";
import { detectAllClients, getDetectedClients } from "./detector";
import { installToClients, generateConfigPreview } from "./installers";
import { McpServerConfig } from "../init/types";

/**
 * CLI flags for install command
 */
export interface InstallFlags {
  claudeDesktop?: boolean;
  claudeCode?: boolean;
  cursor?: boolean;
  vscode?: boolean;
  cline?: boolean;
  rooCode?: boolean;
  windsurf?: boolean;
  all?: boolean;
  show?: boolean;
  force?: boolean;
}

/**
 * Parse install flags from CLI arguments
 */
export function parseInstallFlags(args: string[]): InstallFlags {
  const flags: InstallFlags = {};

  for (const arg of args) {
    switch (arg) {
      case "--claude-desktop":
        flags.claudeDesktop = true;
        break;
      case "--claude-code":
        flags.claudeCode = true;
        break;
      case "--cursor":
        flags.cursor = true;
        break;
      case "--vscode":
        flags.vscode = true;
        break;
      case "--cline":
        flags.cline = true;
        break;
      case "--roo-code":
        flags.rooCode = true;
        break;
      case "--windsurf":
        flags.windsurf = true;
        break;
      case "--all":
        flags.all = true;
        break;
      case "--show":
        flags.show = true;
        break;
      case "--force":
        flags.force = true;
        break;
    }
  }

  return flags;
}

/**
 * Get clients from flags
 */
export function getClientsFromFlags(flags: InstallFlags): InstallableClient[] {
  const clients: InstallableClient[] = [];

  if (flags.claudeDesktop) clients.push("claude-desktop");
  if (flags.claudeCode) clients.push("claude-code");
  if (flags.cursor) clients.push("cursor");
  if (flags.vscode) clients.push("vscode-copilot");
  if (flags.cline) clients.push("cline");
  if (flags.rooCode) clients.push("roo-code");
  if (flags.windsurf) clients.push("windsurf");

  return clients;
}

/**
 * Format detection result for display
 */
function formatDetectionResult(result: ClientDetectionResult): string {
  const metadata = CLIENT_METADATA[result.client];
  let status = result.detected ? "✓" : "✗";

  if (result.alreadyConfigured) {
    status = "⚙"; // Already configured
  }

  let hint = "";
  if (result.alreadyConfigured) {
    hint = " (already configured)";
  } else if (result.detected && result.configExists) {
    hint = " (config exists)";
  } else if (result.detected) {
    hint = " (detected)";
  }

  return `${status} ${metadata.name}${hint}`;
}

/**
 * Run interactive install wizard
 */
export async function runInstallWizard(
  serverConfig: McpServerConfig,
  flags: InstallFlags = {}
): Promise<InstallResult[]> {
  // If --show flag is set, just display config
  if (flags.show) {
    p.intro("GitLab MCP Configuration Preview");

    // Show config for first specified client or claude-desktop
    const specifiedClients = getClientsFromFlags(flags);
    const targetClient = specifiedClients[0] ?? "claude-desktop";

    const preview = generateConfigPreview(targetClient, serverConfig);
    p.note(preview, `Configuration for ${CLIENT_METADATA[targetClient].name}`);

    p.outro("Use these settings to configure your MCP client manually.");
    return [];
  }

  p.intro("Install GitLab MCP to your AI coding assistants");

  // Detect installed clients
  const spinner = p.spinner();
  spinner.start("Detecting installed MCP clients...");

  const detectionResults = detectAllClients();
  const detectedClients = detectionResults.filter(r => r.detected);

  spinner.stop(`Found ${detectedClients.length} MCP clients`);

  if (detectedClients.length === 0) {
    p.log.warn("No MCP clients detected on this system.");
    p.note(
      "Supported clients:\n" +
        INSTALLABLE_CLIENTS.map(c => `  - ${CLIENT_METADATA[c].name}`).join("\n"),
      "Install one of these clients first:"
    );
    p.outro("Setup cancelled.");
    return [];
  }

  // Show detection results
  p.log.info("Detected clients:");
  for (const result of detectionResults) {
    if (result.detected) {
      console.log(`  ${formatDetectionResult(result)}`);
    }
  }

  // Determine target clients
  let targetClients: InstallableClient[];
  const specifiedClients = getClientsFromFlags(flags);

  if (flags.all) {
    // Install to all detected clients
    targetClients = detectedClients.map(r => r.client);
  } else if (specifiedClients.length > 0) {
    // Use specified clients (filter to only detected ones)
    targetClients = specifiedClients.filter(c => detectedClients.some(d => d.client === c));

    // Warn about undetected clients
    const undetected = specifiedClients.filter(c => !detectedClients.some(d => d.client === c));
    if (undetected.length > 0) {
      p.log.warn(
        `Skipping undetected clients: ${undetected.map(c => CLIENT_METADATA[c].name).join(", ")}`
      );
    }
  } else {
    // Interactive selection
    const selectedClients = await p.multiselect({
      message: "Select clients to install to:",
      options: detectedClients.map(result => ({
        value: result.client,
        label: CLIENT_METADATA[result.client].name,
        hint: result.alreadyConfigured ? "already configured" : undefined,
      })),
      required: true,
    });

    if (p.isCancel(selectedClients)) {
      p.cancel("Installation cancelled");
      return [];
    }

    // Type assertion needed because @clack/prompts multiselect returns unknown[]
    targetClients = selectedClients as unknown as InstallableClient[];
  }

  if (targetClients.length === 0) {
    p.log.warn("No clients selected for installation.");
    p.outro("Setup cancelled.");
    return [];
  }

  // Check for already configured clients
  const alreadyConfigured = targetClients.filter(
    c => detectionResults.find(r => r.client === c)?.alreadyConfigured
  );

  if (alreadyConfigured.length > 0 && !flags.force) {
    p.log.warn(
      `Some clients already have gitlab-mcp configured: ${alreadyConfigured.map(c => CLIENT_METADATA[c].name).join(", ")}`
    );

    const overwrite = await p.confirm({
      message: "Overwrite existing configurations?",
      initialValue: false,
    });

    if (p.isCancel(overwrite)) {
      p.cancel("Installation cancelled");
      return [];
    }

    if (!overwrite) {
      // Remove already configured clients from target list
      targetClients = targetClients.filter(c => !alreadyConfigured.includes(c));

      if (targetClients.length === 0) {
        p.log.info("No new clients to configure.");
        p.outro("Setup complete.");
        return [];
      }
    }
  }

  // Install to selected clients
  spinner.start("Installing configuration...");

  const results = installToClients(
    targetClients,
    serverConfig,
    flags.force ?? alreadyConfigured.length > 0
  );

  spinner.stop("Installation complete!");

  // Display results
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length > 0) {
    p.log.success(`Installed to ${successful.length} clients:`);
    for (const result of successful) {
      const metadata = CLIENT_METADATA[result.client];
      let info = `  ✓ ${metadata.name}`;
      if (result.configPath) {
        info += ` (${result.configPath})`;
      }
      if (result.backupPath) {
        info += `\n    Backup: ${result.backupPath}`;
      }
      console.log(info);
    }
  }

  if (failed.length > 0) {
    p.log.error(`Failed for ${failed.length} clients:`);
    for (const result of failed) {
      const metadata = CLIENT_METADATA[result.client];
      console.log(`  ✗ ${metadata.name}: ${result.error}`);
    }
  }

  p.outro(
    successful.length > 0
      ? "Installation complete! Restart your MCP clients to apply changes."
      : "Installation failed."
  );

  return results;
}

/**
 * Run install command (non-interactive mode)
 */
export async function runInstallCommand(
  serverConfig: McpServerConfig,
  flags: InstallFlags
): Promise<InstallResult[]> {
  const specifiedClients = getClientsFromFlags(flags);

  // If --show mode, display config and exit
  if (flags.show) {
    const targetClient = specifiedClients[0] ?? "claude-desktop";
    const preview = generateConfigPreview(targetClient, serverConfig);
    console.log(`Configuration for ${CLIENT_METADATA[targetClient].name}:\n`);
    console.log(preview);
    return [];
  }

  // If specific clients or --all specified, run non-interactively
  if (specifiedClients.length > 0 || flags.all) {
    const detected = getDetectedClients();
    let targetClients: InstallableClient[];

    if (flags.all) {
      targetClients = detected.map(r => r.client);
    } else {
      targetClients = specifiedClients.filter(c => detected.some(d => d.client === c));
    }

    if (targetClients.length === 0) {
      console.error("No supported MCP clients detected.");
      return [];
    }

    const results = installToClients(targetClients, serverConfig, flags.force ?? false);

    // Display results
    for (const result of results) {
      const metadata = CLIENT_METADATA[result.client];
      if (result.success) {
        console.log(`✓ Installed to ${metadata.name}`);
        if (result.backupPath) {
          console.log(`  Backup created: ${result.backupPath}`);
        }
      } else {
        console.error(`✗ Failed for ${metadata.name}: ${result.error}`);
      }
    }

    return results;
  }

  // Otherwise, run interactive wizard
  return runInstallWizard(serverConfig, flags);
}

/**
 * Build server config from environment/defaults
 */
export function buildServerConfigFromEnv(): McpServerConfig {
  const instanceUrl = process.env.GITLAB_URL ?? "https://gitlab.com";
  const token = process.env.GITLAB_TOKEN ?? "";
  const preset = process.env.GITLAB_MCP_PRESET;

  const env: Record<string, string> = {
    GITLAB_URL: instanceUrl,
    GITLAB_TOKEN: token,
  };

  if (preset) {
    env.GITLAB_MCP_PRESET = preset;
  }

  return {
    command: "npx",
    args: ["-y", "@structured-world/gitlab-mcp"],
    env,
  };
}
