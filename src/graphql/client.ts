import { ExecutionResult, print } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { DEFAULT_HEADERS } from '../http-client';
import { GITLAB_AUTH_COOKIE_PATH } from '../config';
import * as fs from 'fs';
import { logger } from '../logger';

/**
 * Reads GitLab authentication cookies from file and formats them for HTTP Cookie header
 */
function loadCookieHeader(): string | null {
  if (!GITLAB_AUTH_COOKIE_PATH) {
    return null;
  }

  try {
    const cookieString = fs.readFileSync(GITLAB_AUTH_COOKIE_PATH, 'utf-8');
    const cookies: string[] = [];

    cookieString.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        // Parse cookie line format: domain flag path secure expiration name value
        const parts = trimmed.split('\t');
        if (parts.length >= 7) {
          const name = parts[5];
          const value = parts[6];
          cookies.push(`${name}=${value}`);
        }
      }
    });

    return cookies.length > 0 ? cookies.join('; ') : null;
  } catch (error: unknown) {
    logger.warn({ err: error }, 'Failed to load GitLab authentication cookies');
    return null;
  }
}

export interface GraphQLClientOptions {
  endpoint: string;
  headers?: Record<string, string>;
}

export class GraphQLClient {
  public readonly endpoint: string;
  private defaultHeaders: Record<string, string>;

  constructor(endpoint: string, options?: { headers?: Record<string, string> }) {
    this.endpoint = endpoint;
    this.defaultHeaders = options?.headers ?? {};
  }

  async request<TResult = unknown, TVariables = Record<string, unknown>>(
    document: TypedDocumentNode<TResult, TVariables>,
    variables?: TVariables,
    requestHeaders?: Record<string, string>,
  ): Promise<TResult> {
    const query = print(document);

    // Prepare headers with authentication (token + cookies)
    const cookieHeader = loadCookieHeader();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...DEFAULT_HEADERS,
      ...this.defaultHeaders,
      ...requestHeaders,
    };

    // Add cookies if available
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const response = await globalThis.fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        variables: variables ?? {},
      }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const result: ExecutionResult<TResult> = (await response.json()) as ExecutionResult<TResult>;

    if (result.errors) {
      throw new Error(`GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`);
    }

    if (!result.data) {
      throw new Error('GraphQL request returned no data');
    }

    return result.data;
  }

  setHeaders(headers: Record<string, string>): void {
    this.defaultHeaders = { ...this.defaultHeaders, ...headers };
  }

  setAuthToken(token: string): void {
    this.setHeaders({ Authorization: `Bearer ${token}` });
  }
}
