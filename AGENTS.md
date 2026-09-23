# AGENTS.md

Guidance for coding agents and reviewers working on this repository.

## GitLab version support

This server supports **GitLab 16.0 and later** (`MIN_SUPPORTED_VERSION` in
`packages/gitlab-mcp/src/services/InstanceCapabilities.ts`). It talks to GitLab only
through REST API v4 and GraphQL.

### Smart MCP, not an API proxy

Tools are an agent-facing layer over GitLab, not a 1:1 proxy: they compose calls,
translate parameters, filter and reshape results, and emulate behaviour an older or
lower-tier instance lacks. When a capability is missing on some instances, prefer, in
order: emulate or degrade (older equivalent, client-side filtering, another endpoint or
query, dropping a non-essential field), then report partial effect in the result, and
only then hide or refuse, when GitLab itself cannot provide it. Never gate away
behaviour a handler already emulates; read the handler before changing its gates.

### Rules

1. **Everything is available from 16.0 unless declared otherwise.** A tool, action or
   parameter that needs a newer GitLab declares it in its `requirements`
   (`default`, `actions.<action>` or `parameters.<name>`, each `{ tier, minVersion }`).
   The registry hides whatever the connected instance does not meet.
2. **Declare `minVersion` only above the floor.** A value at or below 16.0 is ignored
   by the gate and must not be written; it only misleads readers.
3. **Verify every version against GitLab's own sources, never from memory.** For each
   new or changed endpoint, parameter, GraphQL field, argument or fragment type:
   - REST: the `{{< history >}}` notes in `doc/api/*.md`, and the Grape
     `optional`/`requires` declaration in `lib/api` or `ee/lib` at the release tag
     (`vX.Y.0-ee`). Docs often omit the version of a single parameter; the source at
     the tag is authoritative.
   - GraphQL: `doc/api/graphql/reference` at the release tag. GitLab rejects the
     **whole** query when any selected field, argument or inline-fragment type is
     unknown, so a single new field gates the entire query and every action using it.
4. **Version-dependent behaviour in handlers** uses `instanceAtLeast` /
   `currentInstance` from `packages/gitlab-mcp/src/entities/instance-version.ts` to
   pick the native path or the emulation. `assertInstanceAtLeast` (a clear error) is
   only for capabilities GitLab cannot provide on that instance, never a substitute
   for an emulation that is possible.
5. **A 200 response is not proof a setting was applied.** GitLab ignores unknown REST
   parameters and drops license-, add-on- or feature-flag-gated attributes without an
   error. Where that matters, compare the returned entity with the request (see
   `packages/gitlab-mcp/src/entities/core/duo-settings.ts`).

### For reviewers

For every added or changed `minVersion`, endpoint, REST parameter or GraphQL selection,
check the claimed version against the GitLab API documentation or source at that
release. Flag any GitLab API surface newer than 16.0 that is used without a gate or an
emulation, any `minVersion` at or below 16.0, and any gate that hides behaviour the
handler could emulate.
