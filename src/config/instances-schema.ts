/**
 * Instance Configuration Schemas
 *
 * Zod schemas for multi-instance GitLab configuration.
 * Supports YAML/JSON configuration files and environment variable formats.
 */

import { z } from "zod";

/**
 * URL validation and normalization
 * Accepts http/https URLs, removes trailing slashes and /api/v4 suffix
 */
const GitLabUrlSchema = z
  .string()
  .url()
  .transform(url => {
    // Parse URL to extract only origin (protocol + host + port)
    // This strips any paths, query strings, and fragments
    const parsed = new URL(url);
    let normalized = parsed.origin;

    // Ensure trailing slash is removed
    normalized = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;

    // Also check if the input had /api/v4 in the path (warn but still work)
    if (parsed.pathname.startsWith("/api/v4")) {
      // Log would be nice but we're in schema - just strip it
    }

    return normalized;
  })
  .describe("GitLab instance URL (e.g., https://gitlab.com)");

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
 * - "https://gitlab.com:client_id" (URL with OAuth client ID)
 * - "https://gitlab.com:client_id:client_secret" (URL with OAuth credentials)
 */
export function parseInstanceUrlString(urlString: string): GitLabInstanceConfig {
  const parts = urlString.split(":");

  // Handle URLs with protocol (https://...)
  if (parts.length >= 2 && (parts[0] === "https" || parts[0] === "http")) {
    // Reconstruct URL: protocol + ":" + rest
    const protocolEnd = urlString.indexOf("://") + 3;
    const afterProtocol = urlString.slice(protocolEnd);
    const colonParts = afterProtocol.split(":");

    // Extract host (first part before any colon)
    const hostEndIndex = colonParts[0].indexOf("/");
    const host = hostEndIndex === -1 ? colonParts[0] : colonParts[0].slice(0, hostEndIndex);

    // Check if there's a port number
    // A valid port is 1-65535 and purely numeric. OAuth application IDs are typically
    // much larger or alphanumeric (e.g., "app_123" or UUIDs), so we use port range
    // to distinguish between port numbers and OAuth client IDs.
    let url: string;
    let oauthParts: string[] = [];

    if (colonParts.length > 1 && /^\d+$/.test(colonParts[1])) {
      const possiblePort = parseInt(colonParts[1], 10);
      // Valid port range is 1-65535
      if (possiblePort >= 1 && possiblePort <= 65535) {
        // Has port number - include it in URL
        url = `${parts[0]}://${host}:${colonParts[1]}`;
        // OAuth parts come after port
        oauthParts = colonParts.slice(2);
      } else {
        // Number is too large to be a port - treat as OAuth client ID
        url = `${parts[0]}://${host}`;
        oauthParts = colonParts.slice(1);
      }
    } else {
      // No port - URL is just protocol + host
      url = `${parts[0]}://${host}`;
      // OAuth parts start from index 1
      oauthParts = colonParts.slice(1);
    }

    // Normalize URL
    const normalized = GitLabUrlSchema.parse(url);

    // Build config
    const config: GitLabInstanceConfig = {
      url: normalized,
      insecureSkipVerify: false,
    };

    // Add OAuth config if client ID provided
    if (oauthParts.length > 0 && oauthParts[0]) {
      config.oauth = {
        clientId: oauthParts[0],
        scopes: "api read_user",
      };

      if (oauthParts.length > 1 && oauthParts[1]) {
        config.oauth.clientSecret = oauthParts[1];
      }
    }

    return config;
  }

  // Should not reach here with valid URL
  throw new Error(`Invalid GitLab instance URL format: ${urlString}`);
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
