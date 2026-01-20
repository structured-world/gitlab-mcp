#!/usr/bin/env node

import { startServer } from "./server";
import { logger } from "./logger";
import { tryApplyProfileFromEnv } from "./profiles";

/**
 * Parse CLI arguments for --profile flag
 */
function getProfileFromArgs(): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile" && args[i + 1]) {
      return args[i + 1];
    }
  }
  return undefined;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Apply profile if specified (CLI arg > env var > default)
  const profileName = getProfileFromArgs();
  try {
    const result = await tryApplyProfileFromEnv(profileName);
    if (result) {
      logger.info(
        { profile: result.profileName, host: result.host },
        "Using configuration profile"
      );
    }
  } catch (error) {
    // Profile errors are fatal - don't start with misconfigured profile
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to load profile");
    process.exit(1);
  }

  // Start the server
  await startServer();
}

main().catch((error: unknown) => {
  logger.error(`Failed to start GitLab MCP Server: ${String(error)}`);
  process.exit(1);
});
