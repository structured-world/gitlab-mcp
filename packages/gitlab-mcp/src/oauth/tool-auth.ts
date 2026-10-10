/**
 * Tool-level authorization contract
 *
 * In OAuth mode every tool declares that it needs an OAuth access token, and a tool call
 * that fails because GitLab no longer accepts the account's credentials returns a
 * `WWW-Authenticate` challenge in `_meta["mcp/www_authenticate"]`, so the host starts its
 * own reconnect flow instead of asking for a token in chat.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { loadOAuthConfig } from './config';
import { getTokenContext } from './token-context';
import { defaultResource, resourceMetadataUrl } from './resource';
import { isStructuredToolError, parseGitLabApiError } from '../utils/error-handler';

/** Security scheme every tool declares in OAuth mode. */
export interface OAuthSecurityScheme {
  type: 'oauth2';
  scopes: string[];
}

/** Every tool is called with an MCP access token carrying `mcp:tools`. */
export const OAUTH_SECURITY_SCHEMES: readonly OAuthSecurityScheme[] = [
  { type: 'oauth2', scopes: ['mcp:tools'] },
];

/** Scope a tool call needs, the one every tool declares. */
const TOOL_SCOPE = OAUTH_SECURITY_SCHEMES[0].scopes[0];

/**
 * Error result for a tool call whose MCP access token lacks `mcp:tools` (RFC 6750 section
 * 3.1 insufficient_scope), or undefined when the call may proceed. The request middleware
 * admits any MCP scope, so a token granted only `mcp:resources` is stopped here. Calls
 * without an OAuth token context (static token, stdio) are not scope-checked.
 */
export function toolScopeRejection(): CallToolResult | undefined {
  const config = loadOAuthConfig();
  const context = getTokenContext();
  if (!config || !context?.mcpScopes || context.mcpScopes.includes(TOOL_SCOPE)) {
    return undefined;
  }
  const resource = context.resource ?? defaultResource(config.issuer);
  const challenge =
    `Bearer resource_metadata="${resourceMetadataUrl(resource)}", ` +
    `error="insufficient_scope", scope="${TOOL_SCOPE}", ` +
    `error_description="This access token does not allow tool calls; reconnect to grant ${TOOL_SCOPE}"`;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: 'insufficient_scope',
          message: `The access token was not granted ${TOOL_SCOPE}`,
        }),
      },
    ],
    isError: true,
    _meta: { 'mcp/www_authenticate': [challenge] },
  };
}

/** Bound on the cause chain walked when looking for the GitLab status. */
const MAX_CAUSE_DEPTH = 8;

/** Whether GitLab rejected the account's credentials (HTTP 401) anywhere in the cause chain. */
export function isGitLabAuthFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
    if (isStructuredToolError(current)) {
      const status = (current.structuredError as { http_status?: unknown }).http_status;
      if (status === 401) return true;
    }
    if (parseGitLabApiError(current.message)?.status === 401) return true;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Whether GitLab refused because the token lacks an OAuth scope (HTTP 403 with
 * `insufficient_scope`, RFC 6750 section 3.1), as opposed to missing project permissions.
 */
export function isGitLabInsufficientScope(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
    const parsed = parseGitLabApiError(current.message);
    if (parsed?.status === 403 && parsed.message.includes('insufficient_scope')) return true;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Attach a reauthorization challenge to an error result when OAuth is enabled and GitLab
 * rejected the account's credentials (401) or their scope (403 insufficient_scope). The
 * challenge carries `error` and
 * `error_description` (RFC 6750 section 3) and points at the metadata of the resource the
 * client called (RFC 9728 section 5.1). Other results are returned unchanged.
 */
export function withReauthChallenge(result: CallToolResult, error: unknown): CallToolResult {
  const config = loadOAuthConfig();
  if (!config) return result;

  let errorParams: string;
  if (isGitLabAuthFailure(error)) {
    errorParams =
      'error="invalid_token", error_description="GitLab no longer accepts this account\'s authorization; reconnect the GitLab account"';
  } else if (isGitLabInsufficientScope(error)) {
    errorParams =
      `error="insufficient_scope", scope="${OAUTH_SECURITY_SCHEMES[0].scopes.join(' ')}", ` +
      'error_description="The GitLab authorization lacks a scope this action needs; reconnect the GitLab account to grant it"';
  } else {
    return result;
  }

  const resource = getTokenContext()?.resource ?? defaultResource(config.issuer);
  const challenge = `Bearer resource_metadata="${resourceMetadataUrl(resource)}", ${errorParams}`;
  return {
    ...result,
    isError: true,
    _meta: { ...result._meta, 'mcp/www_authenticate': [challenge] },
  };
}
