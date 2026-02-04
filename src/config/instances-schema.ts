/**
 * Instance Configuration Schemas
 *
 * Zod schemas for multi-instance GitLab configuration.
 * Supports YAML/JSON configuration files and environment variable formats.
 */

import { z } from "zod";

/**
 * URL validation and normalization
 * Accepts http/https URLs, preserves subpath for relative URL root deployments,
 * removes trailing slashes and /api/v4 suffix.
 * Supports both https://gitlab.com and https://example.com/gitlab
 */
const GitLabUrlSchema = z
  .string()
  .url()
  .transform(url => {
    const parsed = new URL(url);

    // Start with origin (protocol + host + port)
    let path = parsed.pathname;

    // Normalize root path to empty
    if (path === "/") {
      path = "";
    } else {
      // Remove single trailing slash for non-root paths
      if (path.endsWith("/")) {
        path = path.slice(0, -1);
      }

      // Strip /api/v4 or /api/graphql suffix if present
      for (const apiSuffix of ["/api/v4", "/api/graphql"]) {
        if (path.endsWith(apiSuffix)) {
          path = path.slice(0, -apiSuffix.length);
          // Normalize any resulting "/" back to empty
          if (path === "/") {
            path = "";
          }
          break;
        }
      }
    }

    return `${parsed.origin}${path}`;
  })
  .describe("GitLab instance URL (e.g., https://gitlab.com or https://example.com/gitlab)");

/**
 * OAuth configuration for an instance
 */
export const InstanceOAuthConfigSchema = z
  .object({
    clientId: z.string().min(1).describe("OAuth Application ID"),
    clientSecret: z.string().optional().describe("OAuth Secret (only for confidential apps)"),
    scopes: z
      .string()
      .default("api read_user")
      .describe("OAuth scopes to request (space-separated)"),
  })
  .describe("OAuth configuration for this GitLab instance");

/**
 * Rate limiting configuration for an instance
 */
export const InstanceRateLimitConfigSchema = z
  .object({
    maxConcurrent: z
      .number()
      .int()
      .positive()
      .default(100)
      .describe("Maximum parallel requests to this instance"),
    queueSize: z
      .number()
      .int()
      .positive()
      .default(500)
      .describe("Maximum requests to queue when at capacity"),
    queueTimeout: z
      .number()
      .int()
      .positive()
      .default(60000)
      .describe("Queue wait timeout in milliseconds"),
  })
  .describe("Rate limiting configuration for this instance");

/**
 * Single GitLab instance configuration
 */
export const GitLabInstanceConfigSchema = z
  .object({
    url: GitLabUrlSchema,
    label: z.string().optional().describe("Human-readable name for UI display"),
    oauth: InstanceOAuthConfigSchema.optional(),
    rateLimit: InstanceRateLimitConfigSchema.optional(),
    insecureSkipVerify: z
      .boolean()
      .default(false)
      .describe("Skip TLS certificate verification (development only!)"),
  })
  .describe("Configuration for a single GitLab instance");

/**
 * Default configuration applied to all instances
 */
export const InstanceDefaultsSchema = z
  .object({
    rateLimit: InstanceRateLimitConfigSchema.optional(),
    oauth: z
      .object({
        scopes: z.string().default("api read_user").describe("Default OAuth scopes"),
      })
      .optional(),
  })
  .describe("Default configuration applied to all instances");

/**
 * Complete instances configuration file schema
 */
export const InstancesConfigFileSchema = z
  .object({
    instances: z
      .array(GitLabInstanceConfigSchema)
      .min(1)
      .describe("List of GitLab instances to connect to"),
    defaults: InstanceDefaultsSchema.optional(),
  })
  .describe("GitLab MCP instances configuration file");

/**
 * Connection status for runtime state
 */
export const ConnectionStatusSchema = z.enum(["healthy", "degraded", "offline"]);

/**
 * Inferred types from schemas
 */
export type InstanceOAuthConfig = z.infer<typeof InstanceOAuthConfigSchema>;
export type InstanceRateLimitConfig = z.infer<typeof InstanceRateLimitConfigSchema>;
export type GitLabInstanceConfig = z.infer<typeof GitLabInstanceConfigSchema>;
export type InstanceDefaults = z.infer<typeof InstanceDefaultsSchema>;
export type InstancesConfigFile = z.infer<typeof InstancesConfigFileSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/**
 * Runtime instance state (extends config with runtime data)
 */
export interface GitLabInstanceState extends GitLabInstanceConfig {
  /** Connection health status */
  connectionStatus: ConnectionStatus;
  /** Last health check timestamp */
  lastHealthCheck: Date | null;
  /** Cached introspection result */
  introspectionCache: CachedIntrospection | null;
}

/**
 * Cached introspection data
 */
export interface CachedIntrospection {
  /** GitLab version */
  version: string;
  /** Instance tier (free/premium/ultimate) */
  tier: string;
  /** Available features */
  features: Record<string, boolean>;
  /** Schema info */
  schemaInfo: unknown; // SchemaInfo from SchemaIntrospector
  /** Cache timestamp */
  cachedAt: Date;
}

/**
 * Parse and validate a single instance URL string
 * Supports formats:
 * - "https://gitlab.com" (URL only)
 * - "https://gitlab.com/subpath" (URL with subpath)
 * - "https://gitlab.com:client_id" (URL with OAuth client ID)
 * - "https://gitlab.com:client_id:client_secret" (URL with OAuth credentials)
 * - "https://gitlab.com:8080:client_id:secret" (URL with port and OAuth)
 *
 * Uses right-to-left parsing to extract OAuth credentials, preserving subpaths.
 */
export function parseInstanceUrlString(urlString: string): GitLabInstanceConfig {
  const protocolSeparatorIndex = urlString.indexOf("://");
  if (protocolSeparatorIndex === -1) {
    throw new Error(`Invalid GitLab instance URL format: ${urlString}`);
  }

  const protocolEnd = protocolSeparatorIndex + 3;

  // Helper to check if a string is a valid port number (1-65535)
  const isPortNumber = (str: string): boolean => {
    if (!/^\d+$/.test(str)) return false;
    const num = parseInt(str, 10);
    return num >= 1 && num <= 65535;
  };

  let baseUrlString: string | undefined;
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  // First, try to parse the entire string as a valid URL (no OAuth)
  try {
    baseUrlString = GitLabUrlSchema.parse(urlString);
    // Success - entire string is a valid URL, no OAuth credentials
    clientId = undefined;
    clientSecret = undefined;
  } catch {
    // Parsing failed - likely has OAuth credentials appended
    baseUrlString = undefined;
  }

  // If full URL parsing failed, try extracting OAuth credentials from the end
  if (!baseUrlString) {
    // Try to interpret the string as: <url>:<clientId>:<secret>
    const lastColonIndex = urlString.lastIndexOf(":");
    if (lastColonIndex > protocolEnd) {
      const lastSegment = urlString.slice(lastColonIndex + 1);
      // OAuth segments don't contain slashes and aren't port numbers
      if (!lastSegment.includes("/") && !isPortNumber(lastSegment)) {
        const secondLastColonIndex = urlString.lastIndexOf(":", lastColonIndex - 1);
        if (secondLastColonIndex > protocolEnd) {
          const potentialClientId = urlString.slice(secondLastColonIndex + 1, lastColonIndex);
          if (!potentialClientId.includes("/") && !isPortNumber(potentialClientId)) {
            const potentialBaseUrl = urlString.slice(0, secondLastColonIndex);
            try {
              baseUrlString = GitLabUrlSchema.parse(potentialBaseUrl);
              clientId = potentialClientId;
              clientSecret = lastSegment;
            } catch {
              // Fall through to try other patterns
            }
          }
        }
      }
    }
  }

  // If two-part OAuth parsing failed, try: <url>:<clientId>
  if (!baseUrlString) {
    const singleLastColonIndex = urlString.lastIndexOf(":");
    if (singleLastColonIndex > protocolEnd) {
      const potentialClientId = urlString.slice(singleLastColonIndex + 1);
      // OAuth clientId doesn't contain slashes and isn't a port number
      if (!potentialClientId.includes("/") && !isPortNumber(potentialClientId)) {
        const potentialBaseUrl = urlString.slice(0, singleLastColonIndex);
        try {
          baseUrlString = GitLabUrlSchema.parse(potentialBaseUrl);
          clientId = potentialClientId;
          clientSecret = undefined;
        } catch {
          // Fall through to error
        }
      }
    }
  }

  // If we still don't have a base URL, the input is invalid
  if (!baseUrlString) {
    throw new Error(`Invalid GitLab instance URL format: ${urlString}`);
  }

  // Build config
  const config: GitLabInstanceConfig = {
    url: baseUrlString,
    insecureSkipVerify: false,
  };

  // Add OAuth config if client ID provided
  if (clientId) {
    config.oauth = {
      clientId,
      scopes: "api read_user",
    };

    if (clientSecret) {
      config.oauth.clientSecret = clientSecret;
    }
  }

  return config;
}

/**
 * Validate and normalize a complete instances configuration
 */
export function validateInstancesConfig(config: unknown): InstancesConfigFile {
  return InstancesConfigFileSchema.parse(config);
}

/**
 * Apply defaults to an instance configuration
 */
export function applyInstanceDefaults(
  instance: GitLabInstanceConfig,
  defaults?: InstanceDefaults
): GitLabInstanceConfig {
  if (!defaults) {
    return instance;
  }

  const result: GitLabInstanceConfig = { ...instance };

  // Apply rate limit defaults
  if (defaults.rateLimit && !result.rateLimit) {
    result.rateLimit = { ...defaults.rateLimit };
  }

  // Apply OAuth scope defaults
  if (defaults.oauth?.scopes && result.oauth && !result.oauth.scopes) {
    result.oauth = {
      ...result.oauth,
      scopes: defaults.oauth.scopes,
    };
  }

  return result;
}
