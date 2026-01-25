/**
 * Auto-discovery orchestrator
 *
 * Automatically detects GitLab configuration from the current git repository:
 * 1. Parses git remote to get host and project path
 * 2. Matches host to user-defined profile (if available)
 * 3. Loads project-level configs from .gitlab-mcp/ (if present)
 * 4. Sets default context (namespace/project)
 */

import { parseGitRemote, GitRemoteInfo, listGitRemotes } from "./git-remote";
import { findProfileByHost, ProfileMatchResult } from "./profile-matcher";
import { findProjectConfig, ProjectConfig, loadAndApplyProfile } from "../profiles";
import { logInfo, logWarn, logError, logDebug } from "../logger";
import { extractNamespaceFromPath } from "../utils/namespace";

// ============================================================================
// Types
// ============================================================================

export interface AutoDiscoveryOptions {
  /** Path to repository (default: current directory) */
  repoPath?: string;
  /** Remote name to use (default: origin) */
  remoteName?: string;
  /** Skip project config loading */
  noProjectConfig?: boolean;
  /** Dry run - don't apply any changes */
  dryRun?: boolean;
}

export interface AutoDiscoveryResult {
  /** Detected GitLab host */
  host: string;
  /** Detected project path (group/project) */
  projectPath: string;
  /** Git remote info */
  remote: GitRemoteInfo;
  /** Matched user profile (if any) */
  matchedProfile: ProfileMatchResult | null;
  /** Project configuration (if found) */
  projectConfig: ProjectConfig | null;
  /** Computed GitLab API URL */
  apiUrl: string;
  /** Whether profile was applied */
  profileApplied: boolean;
  /** Whether project config was applied */
  projectConfigApplied: boolean;
  /** All available remotes (for multi-remote scenarios) */
  availableRemotes: GitRemoteInfo[];
}

// ============================================================================
// Discovery Logic
// ============================================================================

/**
 * Auto-discover GitLab configuration from current repository
 *
 * @param options Discovery options
 * @returns Discovery result or null if not in a git repo
 */
export async function autoDiscover(
  options: AutoDiscoveryOptions = {}
): Promise<AutoDiscoveryResult | null> {
  const repoPath = options.repoPath ?? process.cwd();

  logInfo("Starting auto-discovery", { path: repoPath });

  // 1. Parse git remote
  const remote = await parseGitRemote({
    repoPath,
    remoteName: options.remoteName,
  });

  if (!remote) {
    logWarn("Auto-discovery: No git remote found", { path: repoPath });
    return null;
  }

  logInfo("Detected git remote", {
    host: remote.host,
    projectPath: remote.projectPath,
    remote: remote.remoteName,
  });

  // Get all available remotes for info
  const availableRemotes = await listGitRemotes(repoPath);

  // 2. Match host to user profile
  const matchedProfile = await findProfileByHost(remote.host);

  if (matchedProfile) {
    logInfo("Matched host to user profile", {
      profile: matchedProfile.profileName,
      matchType: matchedProfile.matchType,
    });
  } else {
    logDebug("No matching user profile found", { host: remote.host });
  }

  // 3. Load project configs (unless disabled)
  let projectConfig: ProjectConfig | null = null;
  if (!options.noProjectConfig) {
    projectConfig = await findProjectConfig(repoPath);
    if (projectConfig) {
      logInfo("Found project configuration", { path: projectConfig.configPath });
    }
  }

  // Compute API URL
  const apiUrl = `https://${remote.host}`;

  // Build result
  const result: AutoDiscoveryResult = {
    host: remote.host,
    projectPath: remote.projectPath,
    remote,
    matchedProfile,
    projectConfig,
    apiUrl,
    profileApplied: false,
    projectConfigApplied: false,
    availableRemotes,
  };

  // 4. Apply configuration (unless dry run)
  if (!options.dryRun) {
    // Apply profile if matched
    if (matchedProfile) {
      try {
        await loadAndApplyProfile(matchedProfile.profileName);
        result.profileApplied = true;
        logInfo("Applied matched profile", { profile: matchedProfile.profileName });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError("Failed to apply matched profile", { error: message });
      }
    } else {
      // Set API URL from discovered host if no profile matched
      if (!process.env.GITLAB_API_URL) {
        process.env.GITLAB_API_URL = apiUrl;
        logInfo("Set GITLAB_API_URL from discovered host", { apiUrl });
      }
    }

    // Apply project config
    if (projectConfig) {
      result.projectConfigApplied = true;
      // Project config application is logged but not enforced yet
      // See: https://github.com/structured-world/gitlab-mcp/issues/61
      logDebug("Project config loaded (enforcement pending)", { config: projectConfig });
    }

    // Set default context
    setDefaultContext(remote.projectPath);
  }

  return result;
}

/**
 * Set default project/namespace context from discovered project path
 */
function setDefaultContext(projectPath: string): void {
  // Set as environment variables for tools to use
  if (!process.env.GITLAB_DEFAULT_PROJECT) {
    process.env.GITLAB_DEFAULT_PROJECT = projectPath;
    logDebug("Set default project context", { project: projectPath });
  }

  if (!process.env.GITLAB_DEFAULT_NAMESPACE) {
    // Use shared utility to extract namespace
    const namespace = extractNamespaceFromPath(projectPath);
    if (namespace) {
      process.env.GITLAB_DEFAULT_NAMESPACE = namespace;
      logDebug("Set default namespace context", { namespace });
    }
  }
}

// ============================================================================
// Display Functions
// ============================================================================

/**
 * Format auto-discovery result for display (dry-run mode)
 */
export function formatDiscoveryResult(result: AutoDiscoveryResult): string {
  const lines: string[] = [];

  lines.push("Auto-discovery Results");
  lines.push("======================");
  lines.push("");

  // Git Remote
  lines.push("Git Remote:");
  lines.push(`  Remote: ${result.remote.remoteName}`);
  lines.push(`  Host: ${result.host}`);
  lines.push(`  Project: ${result.projectPath}`);
  lines.push(`  Protocol: ${result.remote.protocol}`);
  lines.push(`  URL: ${result.remote.url}`);
  lines.push("");

  // Multiple remotes warning
  if (result.availableRemotes.length > 1) {
    lines.push("Available Remotes:");
    for (const remote of result.availableRemotes) {
      const selected = remote.remoteName === result.remote.remoteName ? " (selected)" : "";
      lines.push(`  ${remote.remoteName}: ${remote.host}/${remote.projectPath}${selected}`);
    }
    lines.push("");
  }

  // Profile Match
  lines.push("Profile Match:");
  if (result.matchedProfile) {
    lines.push(`  Profile: ${result.matchedProfile.profileName}`);
    lines.push(`  Match Type: ${result.matchedProfile.matchType}`);
    if (result.matchedProfile.profile.authType) {
      lines.push(`  Auth: ${result.matchedProfile.profile.authType}`);
    }
    if (result.matchedProfile.profile.readOnly) {
      lines.push(`  Mode: read-only`);
    }
  } else {
    lines.push(`  No matching profile found`);
    lines.push(`  Will use: ${result.apiUrl} (from discovered host)`);
    lines.push(`  Auth: GITLAB_TOKEN environment variable required`);
  }
  lines.push("");

  // Project Config
  lines.push("Project Configuration:");
  if (result.projectConfig) {
    lines.push(`  Path: ${result.projectConfig.configPath}`);
    if (result.projectConfig.preset) {
      lines.push(`  Preset: ${result.projectConfig.preset.description ?? "custom restrictions"}`);
      if (result.projectConfig.preset.scope) {
        const scope = result.projectConfig.preset.scope;
        if (scope.project) {
          lines.push(`    Scope: project "${scope.project}"`);
        } else if (scope.namespace) {
          lines.push(`    Scope: namespace "${scope.namespace}/*"`);
        } else if (scope.projects) {
          lines.push(`    Scope: ${scope.projects.length} projects`);
        }
      }
      if (result.projectConfig.preset.read_only) {
        lines.push(`    Mode: read-only`);
      }
    }
    if (result.projectConfig.profile) {
      lines.push(
        `  Profile: ${result.projectConfig.profile.description ?? "custom tool selection"}`
      );
      if (result.projectConfig.profile.extends) {
        lines.push(`    Extends: ${result.projectConfig.profile.extends}`);
      }
    }
  } else {
    lines.push(`  No .gitlab-mcp/ directory found`);
  }
  lines.push("");

  // Default Context
  lines.push("Default Context:");
  lines.push(`  Project: ${result.projectPath}`);
  const namespace = extractNamespaceFromPath(result.projectPath) ?? result.projectPath;
  lines.push(`  Namespace: ${namespace}`);

  return lines.join("\n");
}
