/**
 * Session Storage Module
 *
 * Provides pluggable storage backends for OAuth sessions:
 * - Memory: Default, development use, no persistence
 * - File: JSON file persistence, single-instance deployments
 * - PostgreSQL: optional, via the @structured-world/gitlab-mcp-db package
 *   (loaded lazily by the factory; not bundled in core)
 */

export * from './types';
export * from './memory';
export * from './file';
export * from './factory';
