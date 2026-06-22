# Changelog

## [9.1.1](https://github.com/structured-world/gitlab-mcp/compare/gitlab-mcp-db-v9.1.0...gitlab-mcp-db-v9.1.1) (2026-06-22)


### Bug Fixes

* **runners:** send job status filter as a GitLab list argument ([#536](https://github.com/structured-world/gitlab-mcp/issues/536)) ([c1b37f9](https://github.com/structured-world/gitlab-mcp/commit/c1b37f98cb95f56dae750fc5ef273ca8832c5823))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @structured-world/gitlab-mcp bumped to 9.1.1

## [9.1.0](https://github.com/structured-world/gitlab-mcp/compare/gitlab-mcp-db-v9.0.1...gitlab-mcp-db-v9.1.0) (2026-06-07)


### Chores

* **gitlab-mcp-db:** Synchronize gitlab-mcp versions


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @structured-world/gitlab-mcp bumped to 9.1.0

## [9.0.1](https://github.com/structured-world/gitlab-mcp/compare/gitlab-mcp-db-v9.0.0...gitlab-mcp-db-v9.0.1) (2026-06-07)


### Bug Fixes

* **db:** add repository field for npm provenance ([#507](https://github.com/structured-world/gitlab-mcp/issues/507)) ([bc52381](https://github.com/structured-world/gitlab-mcp/commit/bc52381b861b45cf2cc19ed8662c99293289ed05)), closes [#506](https://github.com/structured-world/gitlab-mcp/issues/506)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @structured-world/gitlab-mcp bumped to 9.0.1

## [9.0.0](https://github.com/structured-world/gitlab-mcp/compare/gitlab-mcp-db-v8.0.0...gitlab-mcp-db-v9.0.0) (2026-06-07)


### ⚠ BREAKING CHANGES

* OAuth deployments must rename GITLAB_OAUTH_CLIENT_ID, GITLAB_OAUTH_CLIENT_SECRET, and GITLAB_OAUTH_SCOPES to their OAUTH_ equivalents.

### Refactoring

* nx monorepo with optional gitlab-mcp-db package ([#493](https://github.com/structured-world/gitlab-mcp/issues/493)) ([b18085d](https://github.com/structured-world/gitlab-mcp/commit/b18085da9f0d17efc3d440dd3d2fd8d27d0e3a66))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @structured-world/gitlab-mcp bumped to 9.0.0
