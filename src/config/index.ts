/**
 * Configuration Module Index
 *
 * Re-exports all configuration-related functionality.
 */

// Instance configuration schemas and types
export {
  InstanceOAuthConfigSchema,
  InstanceRateLimitConfigSchema,
  GitLabInstanceConfigSchema,
  InstanceDefaultsSchema,
  InstancesConfigFileSchema,
  ConnectionStatusSchema,
  parseInstanceUrlString,
  validateInstancesConfig,
  applyInstanceDefaults,
} from "./instances-schema.js";
export type {
  InstanceOAuthConfig,
  InstanceRateLimitConfig,
  GitLabInstanceConfig,
  InstanceDefaults,
  InstancesConfigFile,
  ConnectionStatus,
  GitLabInstanceState,
  CachedIntrospection,
} from "./instances-schema.js";

// Instance configuration loader
export {
  loadInstancesConfig,
  getInstanceByUrl,
  isKnownInstance,
  generateSampleConfig,
} from "./instances-loader.js";
export type { LoadedInstancesConfig } from "./instances-loader.js";
