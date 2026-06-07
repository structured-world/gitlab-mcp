/**
 * `@structured-world/gitlab-mcp-db` — optional PostgreSQL OAuth-storage backend
 * for gitlab-mcp (issue #492). Core loads this lazily when
 * `OAUTH_STORAGE_TYPE=postgresql`; it is not installed by default.
 */
export { PostgreSQLStorageBackend } from './postgresql';
