/**
 * Profile Applicator - applies profile settings to environment and config
 *
 * Converts profile configuration into environment variables and runtime settings
 * that the rest of the application understands.
 */

import { Profile, ProfileValidationResult } from "./types";
import { ProfileLoader } from "./loader";
import { logger } from "../logger";

// ============================================================================
// Environment Variable Mapping
// ============================================================================

/**
 * Map of profile feature flags to USE_* environment variables
 */
const FEATURE_ENV_MAP: Record<string, string> = {
  wiki: "USE_GITLAB_WIKI",
  milestones: "USE_MILESTONE",
  pipelines: "USE_PIPELINE",
  labels: "USE_LABELS",
  mrs: "USE_MRS",
  files: "USE_FILES",
  variables: "USE_VARIABLES",
  workitems: "USE_WORKITEMS",
  webhooks: "USE_WEBHOOKS",
  snippets: "USE_SNIPPETS",
  integrations: "USE_INTEGRATIONS",
};

// ============================================================================
// Profile Application Result
// ============================================================================

export interface ApplyProfileResult {
  success: boolean;
  profileName: string;
  host: string;
  appliedSettings: string[];
  validation: ProfileValidationResult;
}

// ============================================================================
// Apply Profile
// ============================================================================

/**
 * Apply a profile's settings to environment variables
 *
 * This function sets environment variables based on the profile configuration.
 * The rest of the application reads from environment variables, so this bridges
 * the gap between profile config and runtime behavior.
 *
 * @param profile - The profile to apply
 * @param profileName - Name of the profile (for logging)
 * @returns Result of applying the profile
 */
export async function applyProfile(
  profile: Profile,
  profileName: string
): Promise<ApplyProfileResult> {
  const appliedSettings: string[] = [];
  const loader = new ProfileLoader();
  const validation = await loader.validateProfile(profile);

  // Log warnings but continue
  for (const warning of validation.warnings) {
    logger.warn({ profile: profileName }, warning);
  }

  // Stop on errors
  if (!validation.valid) {
    logger.error({ profile: profileName, errors: validation.errors }, "Profile validation failed");
    return {
      success: false,
      profileName,
      host: profile.host,
      appliedSettings,
      validation,
    };
  }

  // Apply connection settings
  const apiUrl = profile.api_url ?? `https://${profile.host}`;
  process.env.GITLAB_API_URL = apiUrl;
  appliedSettings.push(`GITLAB_API_URL=${apiUrl}`);

  // Apply authentication
  switch (profile.auth.type) {
    case "pat":
      if (profile.auth.token_env) {
        const token = process.env[profile.auth.token_env];
        if (token) {
          process.env.GITLAB_TOKEN = token;
          appliedSettings.push(`GITLAB_TOKEN=<from ${profile.auth.token_env}>`);
        }
      }
      break;

    case "oauth":
      if (profile.auth.client_id_env) {
        const clientId = process.env[profile.auth.client_id_env];
        if (clientId) {
          process.env.GITLAB_OAUTH_CLIENT_ID = clientId;
          appliedSettings.push(`GITLAB_OAUTH_CLIENT_ID=<from ${profile.auth.client_id_env}>`);
        }
      }
      if (profile.auth.client_secret_env) {
        const clientSecret = process.env[profile.auth.client_secret_env];
        if (clientSecret) {
          process.env.GITLAB_OAUTH_CLIENT_SECRET = clientSecret;
          appliedSettings.push(
            `GITLAB_OAUTH_CLIENT_SECRET=<from ${profile.auth.client_secret_env}>`
          );
        }
      }
      process.env.OAUTH_ENABLED = "true";
      appliedSettings.push("OAUTH_ENABLED=true");
      break;

    case "cookie":
      if (profile.auth.cookie_path) {
        process.env.GITLAB_AUTH_COOKIE_PATH = profile.auth.cookie_path;
        appliedSettings.push(`GITLAB_AUTH_COOKIE_PATH=${profile.auth.cookie_path}`);
      }
      break;
  }

  // Apply access control
  if (profile.read_only) {
    process.env.GITLAB_READ_ONLY_MODE = "true";
    appliedSettings.push("GITLAB_READ_ONLY_MODE=true");
  }

  if (profile.allowed_projects && profile.allowed_projects.length > 0) {
    process.env.GITLAB_ALLOWED_PROJECT_IDS = profile.allowed_projects.join(",");
    appliedSettings.push(`GITLAB_ALLOWED_PROJECT_IDS=${profile.allowed_projects.join(",")}`);
  }

  if (profile.denied_tools_regex) {
    process.env.GITLAB_DENIED_TOOLS_REGEX = profile.denied_tools_regex;
    appliedSettings.push(`GITLAB_DENIED_TOOLS_REGEX=${profile.denied_tools_regex}`);
  }

  if (profile.denied_actions && profile.denied_actions.length > 0) {
    process.env.GITLAB_DENIED_ACTIONS = profile.denied_actions.join(",");
    appliedSettings.push(`GITLAB_DENIED_ACTIONS=${profile.denied_actions.join(",")}`);
  }

  // Apply feature flags
  if (profile.features) {
    for (const [feature, envVar] of Object.entries(FEATURE_ENV_MAP)) {
      const value = profile.features[feature as keyof typeof profile.features];
      if (value !== undefined) {
        process.env[envVar] = value ? "true" : "false";
        appliedSettings.push(`${envVar}=${value}`);
      }
    }
  }

  // Apply timeout
  if (profile.timeout_ms) {
    process.env.GITLAB_API_TIMEOUT_MS = String(profile.timeout_ms);
    appliedSettings.push(`GITLAB_API_TIMEOUT_MS=${profile.timeout_ms}`);
  }

  // Apply TLS settings
  if (profile.skip_tls_verify) {
    process.env.SKIP_TLS_VERIFY = "true";
    appliedSettings.push("SKIP_TLS_VERIFY=true");
  }

  if (profile.ssl_cert_path) {
    process.env.SSL_CERT_PATH = profile.ssl_cert_path;
    appliedSettings.push(`SSL_CERT_PATH=${profile.ssl_cert_path}`);
  }

  if (profile.ssl_key_path) {
    process.env.SSL_KEY_PATH = profile.ssl_key_path;
    appliedSettings.push(`SSL_KEY_PATH=${profile.ssl_key_path}`);
  }

  if (profile.ca_cert_path) {
    process.env.GITLAB_CA_CERT_PATH = profile.ca_cert_path;
    appliedSettings.push(`GITLAB_CA_CERT_PATH=${profile.ca_cert_path}`);
  }

  // Apply default project/namespace
  if (profile.default_project) {
    process.env.GITLAB_PROJECT_ID = profile.default_project;
    appliedSettings.push(`GITLAB_PROJECT_ID=${profile.default_project}`);
  }

  logger.info(
    {
      profile: profileName,
      host: profile.host,
      authType: profile.auth.type,
      readOnly: profile.read_only ?? false,
      settingsCount: appliedSettings.length,
    },
    "Profile applied successfully"
  );

  return {
    success: true,
    profileName,
    host: profile.host,
    appliedSettings,
    validation,
  };
}

// ============================================================================
// Load and Apply Profile
// ============================================================================

/**
 * Load and apply a profile by name
 *
 * Convenience function that combines loading and applying.
 *
 * @param profileName - Name of the profile to load and apply
 * @returns Result of applying the profile
 */
export async function loadAndApplyProfile(profileName: string): Promise<ApplyProfileResult> {
  const loader = new ProfileLoader();
  const profile = await loader.loadProfile(profileName);
  return applyProfile(profile, profileName);
}

/**
 * Try to apply profile from environment or CLI args
 *
 * @param cliProfileName - Profile name from CLI argument (optional)
 * @returns Result if a profile was applied, undefined otherwise
 */
export async function tryApplyProfileFromEnv(
  cliProfileName?: string
): Promise<ApplyProfileResult | undefined> {
  // Priority: CLI arg > env var > default profile
  const profileName =
    cliProfileName ?? process.env.GITLAB_PROFILE ?? (await getDefaultProfileName());

  if (!profileName) {
    logger.debug("No profile specified, using environment variables directly");
    return undefined;
  }

  try {
    return await loadAndApplyProfile(profileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ profile: profileName, error: message }, "Failed to apply profile");
    throw error;
  }
}

/**
 * Get default profile name from user config
 */
async function getDefaultProfileName(): Promise<string | undefined> {
  const loader = new ProfileLoader();
  return loader.getDefaultProfileName();
}
