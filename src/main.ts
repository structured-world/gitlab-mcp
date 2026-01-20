#!/usr/bin/env node

import { startServer } from "./server";
import { logger } from "./logger";
import {
  tryApplyProfileFromEnv,
  findProjectConfig,
  getProjectConfigSummary,
  ProjectConfig,
} from "./profiles";

/**
 * CLI arguments parsed from command line
 */
interface CliArgs {
  profileName?: string;
  noProjectConfig: boolean;
  showProjectConfig: boolean;
}

/**
 * Parse CLI arguments
 */
function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    noProjectConfig: false,
    showProjectConfig: false,
  };

  let profileCount = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--profile") {
      const value = args[i + 1];
      // Validate that value exists and is not another flag
      if (!value || value.startsWith("--")) {
        logger.error("--profile requires a profile name (e.g., --profile work)");
        process.exit(1);
      }
      profileCount++;
      if (profileCount === 1) {
        result.profileName = value;
      }
      i++; // Skip value
    } else if (arg === "--no-project-config") {
      result.noProjectConfig = true;
    } else if (arg === "--show-project-config") {
      result.showProjectConfig = true;
    }
  }

  if (profileCount > 1) {
    logger.warn({ count: profileCount }, "Multiple --profile flags detected, using first value");
  }

  return result;
}

/**
 * Display project configuration and exit
 */
function displayProjectConfig(config: ProjectConfig | null): void {
  if (!config) {
    console.log("No project configuration found in current directory or parent directories.");
    console.log("\nTo create a project config, add .gitlab-mcp/ directory with:");
    console.log("  - preset.yaml  (restrictions: scope, denied_actions, features)");
    console.log("  - profile.yaml (tool selection: extends, additional_tools)");
    return;
  }

  const summary = getProjectConfigSummary(config);

  console.log("Project Configuration");
  console.log("=====================");
  console.log(`Path: ${config.configPath}`);
  console.log();

  if (config.preset) {
    console.log("Preset (restrictions):");
    if (config.preset.description) {
      console.log(`  Description: ${config.preset.description}`);
    }
    if (config.preset.scope) {
      if (config.preset.scope.project) {
        console.log(`  Scope: project "${config.preset.scope.project}"`);
      } else if (config.preset.scope.namespace) {
        console.log(`  Scope: namespace "${config.preset.scope.namespace}/*"`);
      } else if (config.preset.scope.projects) {
        console.log(`  Scope: ${config.preset.scope.projects.length} projects`);
        for (const p of config.preset.scope.projects) {
          console.log(`    - ${p}`);
        }
      }
    }
    if (config.preset.read_only) {
      console.log("  Read-only: yes");
    }
    if (config.preset.denied_actions?.length) {
      console.log(`  Denied actions: ${config.preset.denied_actions.join(", ")}`);
    }
    if (config.preset.denied_tools?.length) {
      console.log(`  Denied tools: ${config.preset.denied_tools.join(", ")}`);
    }
    if (config.preset.features) {
      const features = Object.entries(config.preset.features)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (features) {
        console.log(`  Features: ${features}`);
      }
    }
    console.log();
  }

  if (config.profile) {
    console.log("Profile (tool selection):");
    if (config.profile.description) {
      console.log(`  Description: ${config.profile.description}`);
    }
    if (config.profile.extends) {
      console.log(`  Extends: ${config.profile.extends}`);
    }
    if (config.profile.additional_tools?.length) {
      console.log(`  Additional tools: ${config.profile.additional_tools.join(", ")}`);
    }
    if (config.profile.denied_tools?.length) {
      console.log(`  Denied tools: ${config.profile.denied_tools.join(", ")}`);
    }
    if (config.profile.features) {
      const features = Object.entries(config.profile.features)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (features) {
        console.log(`  Features: ${features}`);
      }
    }
    console.log();
  }

  console.log("Summary:");
  if (summary.presetSummary) {
    console.log(`  Preset: ${summary.presetSummary}`);
  }
  if (summary.profileSummary) {
    console.log(`  Profile: ${summary.profileSummary}`);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const cliArgs = parseCliArgs();

  // Handle --show-project-config flag (display and exit)
  if (cliArgs.showProjectConfig) {
    try {
      const projectConfig = await findProjectConfig(process.cwd());
      displayProjectConfig(projectConfig);
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Failed to load project config");
      process.exit(1);
    }
  }

  // Apply profile if specified (CLI arg > env var > default)
  try {
    const result = await tryApplyProfileFromEnv(cliArgs.profileName);
    if (result) {
      // Handle both profile and preset results
      if ("profileName" in result) {
        logger.info(
          { profile: result.profileName, host: result.host },
          "Using configuration profile"
        );
      } else {
        logger.info({ preset: result.presetName }, "Using configuration preset");
      }
    }
  } catch (error) {
    // Profile errors are fatal - don't start with misconfigured profile
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to load profile");
    process.exit(1);
  }

  // Load project config unless --no-project-config is specified
  if (!cliArgs.noProjectConfig) {
    try {
      const projectConfig = await findProjectConfig(process.cwd());
      if (projectConfig) {
        const summary = getProjectConfigSummary(projectConfig);
        logger.info(
          {
            path: projectConfig.configPath,
            preset: summary.presetSummary,
            profile: summary.profileSummary,
          },
          "Loaded project configuration"
        );

        // TODO: Apply project config restrictions to tool registry
        // This will be implemented when integrating with the tool execution layer
      }
    } catch (error) {
      // Project config errors are warnings, not fatal
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error: message }, "Failed to load project config, continuing without it");
    }
  }

  // Start the server
  await startServer();
}

main().catch((error: unknown) => {
  logger.error(`Failed to start GitLab MCP Server: ${String(error)}`);
  process.exit(1);
});
