/**
 * OAuth Dynamic Client Registration Endpoint (RFC 7591)
 *
 * Required by Claude.ai custom connectors.
 * Allows MCP clients to dynamically register themselves.
 */

import { Request, Response } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { logInfo, logError, logWarn } from '../../logger';
import { loadOAuthConfig } from '../config';
import { sessionStore } from '../session-store';
import type { RegisteredOAuthClient } from '../types';
import { TOKEN_ENDPOINT_AUTH_METHODS } from '../resource';

/**
 * Registration is anonymous and durable (RFC 7591 section 3 allows an open endpoint), so
 * what one source can occupy is bounded: at most this many registrations per source in
 * any hour, and never-used ones expire. Over the limit new registrations are refused
 * (RFC 6585 429); none is removed for it, because sources behind one proxy or NAT share
 * an address and an earlier client may still be signing in.
 */
export const REGISTRATIONS_PER_SOURCE_PER_HOUR = 100;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
/** A registration that never completes an authorization is removed after this long. */
const UNUSED_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Keyed hash of the registering address: groups registrations without storing the IP. */
function registrationSource(req: Request, secret: string): string {
  const address = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  return createHmac('sha256', secret).update(address).digest('base64url').slice(0, 22);
}

/** Client registration request body */
interface ClientRegistrationRequest {
  redirect_uris?: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
}

/** Registered client data */
interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  created_at: number;
}

function toRegisteredClient(client: RegisteredOAuthClient): RegisteredClient {
  return {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uris: client.redirectUris,
    client_name: client.clientName,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    created_at: client.createdAt,
  };
}

/**
 * Dynamic Client Registration endpoint handler
 *
 * POST /register
 *
 * Accepts client metadata and returns client credentials.
 * Supports public clients (no client_secret) for Claude.ai.
 */
export async function registerHandler(req: Request, res: Response): Promise<void> {
  const config = loadOAuthConfig();
  if (!config) {
    res.status(500).json({ error: 'server_error', error_description: 'OAuth not configured' });
    return;
  }
  try {
    const body = req.body as ClientRegistrationRequest;
    const {
      redirect_uris,
      client_name,
      token_endpoint_auth_method = 'none',
      grant_types = ['authorization_code', 'refresh_token'],
      response_types = ['code'],
    } = body;

    // RFC 7591 section 3.2.2: only methods the token endpoint authenticates are registered.
    if (!TOKEN_ENDPOINT_AUTH_METHODS.includes(token_endpoint_auth_method)) {
      res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: `token_endpoint_auth_method must be one of ${TOKEN_ENDPOINT_AUTH_METHODS.join(', ')}`,
      });
      return;
    }

    // Validate required fields
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris is required and must be a non-empty array',
      });
      return;
    }

    // Validate redirect URIs (must be valid URLs)
    for (const uri of redirect_uris) {
      try {
        new URL(uri);
      } catch {
        res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: `Invalid redirect URI: ${uri}`,
        });
        return;
      }
    }

    // Concurrent registrations of one source may each pass the count: the limit is a
    // bound on storage, not an exact quota.
    const createdAt = Date.now();
    const registeredFrom = registrationSource(req, config.sessionSecret);
    const recent = await sessionStore.countClientsRegisteredSince(
      registeredFrom,
      createdAt - REGISTRATION_WINDOW_MS,
    );
    if (recent >= REGISTRATIONS_PER_SOURCE_PER_HOUR) {
      logWarn('Client registration refused: hourly limit of the source reached', { recent });
      res.set('Retry-After', String(REGISTRATION_WINDOW_MS / 1000));
      res.status(429).json({
        error: 'temporarily_unavailable',
        error_description: 'Too many client registrations from this address; retry later',
      });
      return;
    }

    // Generate client credentials
    const client_id = randomUUID();

    // For public clients (token_endpoint_auth_method: "none"), no secret is issued
    // For confidential clients, generate a secret
    let client_secret: string | undefined;
    if (token_endpoint_auth_method !== 'none') {
      client_secret = randomUUID() + randomUUID(); // Long random secret
    }

    // Store client registration in the shared storage backend, so every replica and every
    // restart knows the client; the response is sent only once the registration is stored.
    await sessionStore.storeClient({
      clientId: client_id,
      clientSecret: client_secret,
      redirectUris: redirect_uris,
      clientName: client_name,
      tokenEndpointAuthMethod: token_endpoint_auth_method,
      grantTypes: grant_types,
      responseTypes: response_types,
      createdAt,
      registeredFrom,
      expiresAt: createdAt + UNUSED_REGISTRATION_TTL_MS,
    });
    logInfo('New OAuth client registered via DCR', {
      client_id,
      client_name,
      redirect_uris,
      token_endpoint_auth_method,
    });

    // Return client credentials per RFC 7591
    const response: Record<string, unknown> = {
      client_id,
      redirect_uris,
      client_name,
      token_endpoint_auth_method,
      grant_types,
      response_types,
    };

    // Only include client_secret for confidential clients
    if (client_secret) {
      response.client_secret = client_secret;
    }

    res.status(201).json(response);
  } catch (error: unknown) {
    logError('Error in dynamic client registration', { err: error as Error });
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to register client',
    });
  }
}

/**
 * Get a registered client by ID
 */
export async function getRegisteredClient(clientId: string): Promise<RegisteredClient | undefined> {
  const client = await sessionStore.getClient(clientId);
  // An unused registration past its expiry is gone even before cleanup removes it.
  if (!client || (client.expiresAt !== undefined && client.expiresAt < Date.now())) {
    return undefined;
  }
  return toRegisteredClient(client);
}

/**
 * Validate a client's redirect URI
 */
export async function isValidRedirectUri(clientId: string, redirectUri: string): Promise<boolean> {
  const client = await getRegisteredClient(clientId);
  if (!client) {
    // If client is not registered via DCR, allow any redirect URI
    // (for backwards compatibility with static client_id configuration)
    return true;
  }
  return client.redirect_uris.includes(redirectUri);
}
