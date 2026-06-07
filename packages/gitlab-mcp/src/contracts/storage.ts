/**
 * Public storage contract for out-of-tree OAuth-storage backends (issue #492).
 *
 * The optional `@structured-world/gitlab-mcp-db` package implements
 * {@link SessionStorageBackend} against this type-only surface, so it depends on
 * core for types only (erased at compile time) and never at runtime. Core loads
 * the db package lazily, keeping the dependency one-directional.
 */
export type {
  SessionStorageBackend,
  SessionStorageStats,
  StorageConfig,
} from '../oauth/storage/types';
export type {
  OAuthSession,
  DeviceFlowState,
  AuthCodeFlowState,
  AuthorizationCode,
} from '../oauth/types';
