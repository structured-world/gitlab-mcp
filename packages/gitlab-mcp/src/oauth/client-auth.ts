/**
 * Client authentication of the token and revocation endpoints (RFC 6749 section 2.3,
 * RFC 7009 section 2.1).
 */

import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getRegisteredClient } from './endpoints/register';

/** Client credentials a request may carry in its form body. */
export interface ClientCredentialParams {
  client_id?: string;
  client_secret?: string;
}

export type ClientAuthentication =
  | { authenticated: true; clientId: string | undefined }
  | {
      authenticated: false;
      status: number;
      error: string;
      description: string;
      challenge: boolean;
    };

const CLIENT_AUTHENTICATION_FAILED = {
  authenticated: false,
  status: 401,
  error: 'invalid_client',
  description: 'Client authentication failed',
} as const;

/**
 * Id and secret of an `Authorization: Basic` header. RFC 6749 section 2.3.1: both are
 * form-urlencoded before base64 encoding. Undefined when the header is malformed.
 */
function basicCredentials(header: string): { id: string; secret: string } | undefined {
  const decoded = Buffer.from(header, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return undefined;
  const formDecode = (value: string) => decodeURIComponent(value.replaceAll('+', ' '));
  try {
    return {
      id: formDecode(decoded.slice(0, separator)),
      secret: formDecode(decoded.slice(separator + 1)),
    };
  } catch {
    return undefined;
  }
}

/** Constant-time comparison of a presented secret with the registered one. */
function secretMatches(presented: string, registered: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(registered).digest();
  return timingSafeEqual(a, b);
}

/**
 * Authenticate the client of a request (RFC 6749 section 2.3). A client registered with a
 * secret (client_secret_basic or client_secret_post) must present it, in the Authorization
 * header or the form, never both (section 2.3). A public client, registered with `none` or
 * not registered (the device flow), identifies itself with client_id.
 */
export async function authenticateClient(
  req: Request,
  params: ClientCredentialParams,
): Promise<ClientAuthentication> {
  const header = req.headers?.authorization;
  const basicHeader =
    typeof header === 'string' && /^basic /i.test(header) ? header.slice(6).trim() : undefined;
  const basic = basicHeader === undefined ? undefined : basicCredentials(basicHeader);
  if (basicHeader !== undefined && !basic) {
    return { ...CLIENT_AUTHENTICATION_FAILED, challenge: true };
  }
  if (basic && params.client_secret !== undefined) {
    return {
      authenticated: false,
      status: 400,
      error: 'invalid_request',
      description: 'Use one client authentication method',
      challenge: false,
    };
  }
  if (basic && params.client_id !== undefined && params.client_id !== basic.id) {
    return {
      authenticated: false,
      status: 400,
      error: 'invalid_request',
      description: 'client_id does not match the Authorization header',
      challenge: false,
    };
  }

  const clientId = basic?.id ?? params.client_id;
  if (clientId === undefined) return { authenticated: true, clientId };

  const registered = await getRegisteredClient(clientId);
  if (!registered || registered.token_endpoint_auth_method === 'none') {
    return { authenticated: true, clientId };
  }
  const presented = basic?.secret ?? params.client_secret;
  if (
    presented === undefined ||
    registered.client_secret === undefined ||
    !secretMatches(presented, registered.client_secret)
  ) {
    return { ...CLIENT_AUTHENTICATION_FAILED, challenge: basic !== undefined };
  }
  return { authenticated: true, clientId };
}
