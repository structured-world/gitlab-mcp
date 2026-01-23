#!/usr/bin/env node

import { startServer } from "./server";
import { logger } from "./logger";
import { tryApplyProfileFromEnv, findProjectConfig, getProjectConfigSummary } from "./profiles";
import { parseCliArgs, displayProjectConfig } from "./cli-utils";
import { autoDiscover, formatDiscoveryResult, AutoDiscoveryResult } from "./discovery";
import { extractNamespaceFromPath } from "./utils/namespace";

/**
 * Configuration priority (highest to lowest):
 * 1. --profile CLI argument - selects user profile (host, auth)
 * 2. Project config files (.gitlab-mcp/) - adds restrictions and tool selection
 * 3. Auto-discovered profile from git remote - fallback profile selection
 *
 * Note: Project config (preset.yaml, profile.yaml) ADDS restrictions on top
 * of the selected profile - it doesn't replace the profile selection.
 *
 * When --auto detects a profile but --profile or project config specifies
 * a different one, a warning is logged.
 */

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const cliArgs = parseCliArgs();

  // Handle setup subcommand (unified wizard)
  if (cliArgs.setup) {
    const { runSetupWizard } = await import("./cli/setup");
    const result = await runSetupWizard({ mode: cliArgs.setupMode });
    process.exit(result.success ? 0 : 1);
  }

  // Handle init subcommand (alias for setup --mode=local)
  if (cliArgs.init) {
    const { runSetupWizard } = await import("./cli/setup");
    const result = await runSetupWizard({ mode: "local" });
    process.exit(result.success ? 0 : 1);
  }

  // Handle install subcommand
  if (cliArgs.install) {
    const { runInstallCommand, parseInstallFlags, buildServerConfigFromEnv } =
      await import("./cli/install");
    const flags = parseInstallFlags(cliArgs.installArgs);
    const serverConfig = buildServerConfigFromEnv();
    await runInstallCommand(serverConfig, flags);
    process.exit(0);
  }

  // Handle docker subcommand
  if (cliArgs.docker) {
    // docker init is alias for setup --mode=server
    if (cliArgs.dockerArgs[0] === "init") {
      const { runSetupWizard } = await import("./cli/setup");
      const result = await runSetupWizard({ mode: "server" });
      process.exit(result.success ? 0 : 1);
      return;
    }
    const { runDockerCommand } = await import("./cli/docker");
    await runDockerCommand(cliArgs.dockerArgs);
    process.exit(0);
  }

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

  // Track configuration sources
  let autoDiscoveryResult: AutoDiscoveryResult | null = null;

  // Step 1: Run auto-discovery if --auto flag is set (gather info, don't apply yet)
  if (cliArgs.auto) {
    try {
      autoDiscoveryResult = await autoDiscover({
        repoPath: cliArgs.cwd,
        remoteName: cliArgs.remoteName,
        noProjectConfig: true, // We'll handle project config separately for priority
        dryRun: cliArgs.dryRun,
      });

      if (autoDiscoveryResult) {
        // If dry-run, display results and exit
        if (cliArgs.dryRun) {
          console.log(formatDiscoveryResult(autoDiscoveryResult));
          process.exit(0);
        }

        logger.info(
          {
            host: autoDiscoveryResult.host,
            project: autoDiscoveryResult.projectPath,
            profile: autoDiscoveryResult.matchedProfile?.profileName,
          },
          "Auto-discovery detected GitLab configuration"
        );
      } else {
        logger.warn("Auto-discovery failed: not in a git repository or no remote found");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Auto-discovery failed");
      process.exit(1);
    }
  }

  // Step 2: Apply profile (priority: --profile > auto-discovered)
  if (cliArgs.profileName) {
    // CLI profile has highest priority
    try {
      const result = await tryApplyProfileFromEnv(cliArgs.profileName);
      if (result) {
        if ("profileName" in result) {
          logger.info(
            { profile: result.profileName, host: result.host },
            "Using CLI-specified profile"
          );
        } else {
          logger.info({ preset: result.presetName }, "Using CLI-specified preset");
        }

        // Warn if auto-discovery found a different profile
        if (
          autoDiscoveryResult?.matchedProfile &&
          autoDiscoveryResult.matchedProfile.profileName !== cliArgs.profileName
        ) {
          logger.warn(
            {
              cliProfile: cliArgs.profileName,
              autoProfile: autoDiscoveryResult.matchedProfile.profileName,
            },
            "Auto-discovered profile ignored: --profile takes precedence"
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Failed to load profile");
      process.exit(1);
    }
  } else if (autoDiscoveryResult?.matchedProfile) {
    // Auto-discovered profile is fallback
    try {
      const result = await tryApplyProfileFromEnv(autoDiscoveryResult.matchedProfile.profileName);
      if (result && "profileName" in result) {
        logger.info(
          { profile: result.profileName, host: result.host },
          "Using auto-discovered profile"
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error: message }, "Failed to apply auto-discovered profile");
    }
  } else {
    // No CLI profile and no auto-discovery - try default from env
    try {
      const result = await tryApplyProfileFromEnv();
      if (result) {
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
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Failed to load profile");
      process.exit(1);
    }
  }

  // Step 3: Load project config (adds restrictions on top of profile)
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
          "Loaded project configuration (restrictions applied)"
        );

        // Note: Project config is loaded and logged but not yet enforced.
        // Scope restrictions require integration with tool execution layer.
        // See: https://github.com/structured-world/gitlab-mcp/issues/61
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error: message }, "Failed to load project config, continuing without it");
    }
  }

  // Step 4: Set default project/namespace from auto-discovery if available
  if (autoDiscoveryResult) {
    // Set default project path if not already set
    process.env.GITLAB_DEFAULT_PROJECT ??= autoDiscoveryResult.projectPath;

    // Extract namespace using shared utility
    const namespace = extractNamespaceFromPath(autoDiscoveryResult.projectPath);
    if (namespace) {
      process.env.GITLAB_DEFAULT_NAMESPACE ??= namespace;
    }

    logger.debug(
      {
        defaultProject: process.env.GITLAB_DEFAULT_PROJECT,
        defaultNamespace: process.env.GITLAB_DEFAULT_NAMESPACE,
      },
      "Default context set from auto-discovery"
    );
  }

  // Start the server
  await startServer();
}

main().catch((error: unknown) => {
  logger.error(`Failed to start GitLab MCP Server: ${String(error)}`);
  process.exit(1);
});
