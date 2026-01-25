/**
 * CLI utility functions for main entry point
 * Extracted for testability
 */

import { logWarn, logError } from "./logger";
import { getProjectConfigSummary, ProjectConfig } from "./profiles";

/**
 * CLI arguments parsed from command line
 */
export interface CliArgs {
  profileName?: string;
  noProjectConfig: boolean;
  showProjectConfig: boolean;
  /** Enable auto-discovery from git remote */
  auto: boolean;
  /** Custom working directory for auto-discovery */
  cwd?: string;
  /** Dry run - show what would be detected without applying */
  dryRun: boolean;
  /** Git remote name to use (default: origin) */
  remoteName?: string;
  /** Run unified setup wizard */
  setup: boolean;
  /** Setup wizard mode override */
  setupMode?: "local" | "server" | "configure-existing";
  /** Run init wizard (alias for setup --mode=local) */
  init: boolean;
  /** Run install command */
  install: boolean;
  /** Install command arguments */
  installArgs: string[];
  /** Run docker command */
  docker: boolean;
  /** Docker command arguments */
  dockerArgs: string[];
}

/**
 * Parse CLI arguments
 * @param argv - process.argv array (or mock for testing)
 * @returns Parsed CLI arguments
 */
export function parseCliArgs(argv: string[] = process.argv): CliArgs {
  const args = argv.slice(2);
  const result: CliArgs = {
    noProjectConfig: false,
    showProjectConfig: false,
    auto: false,
    dryRun: false,
    setup: false,
    init: false,
    install: false,
    installArgs: [],
    docker: false,
    dockerArgs: [],
  };

  // Check for subcommands (first positional arg)
  if (args.length > 0) {
    switch (args[0]) {
      case "setup":
        result.setup = true;
        // Parse setup-specific flags
        for (const arg of args.slice(1)) {
          if (arg === "--mode=local") result.setupMode = "local";
          else if (arg === "--mode=server") result.setupMode = "server";
          else if (arg === "--mode=configure-existing") result.setupMode = "configure-existing";
        }
        return result;
      case "init":
        result.init = true;
        return result;
      case "install":
        result.install = true;
        result.installArgs = args.slice(1);
        return result;
      case "docker":
        result.docker = true;
        result.dockerArgs = args.slice(1);
        return result;
    }
  }

  let profileCount = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--profile") {
      const value = args[i + 1];
      // Validate that value exists and is not another flag
      if (!value || value.startsWith("--")) {
        logError("--profile requires a profile name (e.g., --profile work)");
        throw new Error("--profile requires a profile name");
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
    } else if (arg === "--auto") {
      result.auto = true;
    } else if (arg === "--cwd") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        logError("--cwd requires a directory path (e.g., --cwd /path/to/repo)");
        throw new Error("--cwd requires a directory path");
      }
      result.cwd = value;
      i++; // Skip value
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--remote") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        logError("--remote requires a remote name (e.g., --remote upstream)");
        throw new Error("--remote requires a remote name");
      }
      result.remoteName = value;
      i++; // Skip value
    }
  }

  if (profileCount > 1) {
    logWarn("Multiple --profile flags detected, using first value", { count: profileCount });
  }

  return result;
}

/**
 * Display project configuration to console
 * @param config - Project configuration or null
 * @param output - Output function (default: console.log, can be mocked for testing)
 */
export function displayProjectConfig(
  config: ProjectConfig | null,
  output: (msg: string) => void = console.log
): void {
  if (!config) {
    output("No project configuration found in current directory or parent directories.");
    output("\nTo create a project config, add .gitlab-mcp/ directory with:");
    output("  - preset.yaml  (restrictions: scope, denied_actions, features)");
    output("  - profile.yaml (tool selection: extends, additional_tools)");
    return;
  }

  const summary = getProjectConfigSummary(config);

  output("Project Configuration");
  output("=====================");
  output(`Path: ${config.configPath}`);
  output("");

  if (config.preset) {
    output("Preset (restrictions):");
    if (config.preset.description) {
      output(`  Description: ${config.preset.description}`);
    }
    if (config.preset.scope) {
      if (config.preset.scope.project) {
        output(`  Scope: project "${config.preset.scope.project}"`);
      } else if (config.preset.scope.namespace) {
        output(`  Scope: namespace "${config.preset.scope.namespace}/*"`);
      } else if (config.preset.scope.projects) {
        output(`  Scope: ${config.preset.scope.projects.length} projects`);
        for (const p of config.preset.scope.projects) {
          output(`    - ${p}`);
        }
      }
    }
    if (config.preset.read_only) {
      output("  Read-only: yes");
    }
    if (config.preset.denied_actions?.length) {
      output(`  Denied actions: ${config.preset.denied_actions.join(", ")}`);
    }
    if (config.preset.denied_tools?.length) {
      output(`  Denied tools: ${config.preset.denied_tools.join(", ")}`);
    }
    if (config.preset.features) {
      const features = Object.entries(config.preset.features)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (features) {
        output(`  Features: ${features}`);
      }
    }
    output("");
  }

  if (config.profile) {
    output("Profile (tool selection):");
    if (config.profile.description) {
      output(`  Description: ${config.profile.description}`);
    }
    if (config.profile.extends) {
      output(`  Extends: ${config.profile.extends}`);
    }
    if (config.profile.additional_tools?.length) {
      output(`  Additional tools: ${config.profile.additional_tools.join(", ")}`);
    }
    if (config.profile.denied_tools?.length) {
      output(`  Denied tools: ${config.profile.denied_tools.join(", ")}`);
    }
    if (config.profile.features) {
      const features = Object.entries(config.profile.features)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (features) {
        output(`  Features: ${features}`);
      }
    }
    output("");
  }

  output("Summary:");
  if (summary.presetSummary) {
    output(`  Preset: ${summary.presetSummary}`);
  }
  if (summary.profileSummary) {
    output(`  Profile: ${summary.profileSummary}`);
  }
}
