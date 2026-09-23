import { ExecutionResult, print } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { DEFAULT_HEADERS } from '../http-client';
import { enhancedFetch } from '../utils/fetch';
import type { SchemaFieldIndex } from '../services/SchemaIntrospector';
import { prepareDocument } from './prepare-document';

export interface GraphQLClientOptions {
  endpoint: string;
  headers?: Record<string, string>;
}

export class GraphQLClient {
  private _endpoint: string;
  private defaultHeaders: Record<string, string>;
  private schemaIndexProvider: () => SchemaFieldIndex | undefined = () => undefined;

  constructor(endpoint: string, options?: { headers?: Record<string, string> }) {
    this._endpoint = endpoint;
    this.defaultHeaders = options?.headers ?? {};
  }

  /**
   * Source of the instance schema used to adapt each document before sending it
   * (see prepareDocument). Read per request, so it sees introspection results
   * that arrive after the client was created.
   */
  public setSchemaIndexProvider(provider: () => SchemaFieldIndex | undefined): void {
    this.schemaIndexProvider = provider;
  }

  public get endpoint(): string {
    return this._endpoint;
  }

  /**
   * Update the GraphQL endpoint.
   *
   * @deprecated Since multi-instance support (v1.x), prefer using per-instance
   * clients via InstanceConnectionPool.getGraphQLClient() instead of mutating
   * a shared client. This avoids race conditions in concurrent async scenarios.
   * Kept for backward compatibility with legacy single-instance usage.
   */
  public setEndpoint(endpoint: string): void {
    this._endpoint = endpoint;
  }

  async request<TResult = unknown, TVariables = Record<string, unknown>>(
    document: TypedDocumentNode<TResult, TVariables>,
    variables?: TVariables,
    requestHeaders?: Record<string, string>,
  ): Promise<TResult> {
    const prepared = prepareDocument(document, this.schemaIndexProvider());
    const query = print(prepared.document);
    const sentVariables = Object.fromEntries(
      Object.entries((variables ?? {}) as Record<string, unknown>).filter(([name]) =>
        prepared.variableNames.has(name),
      ),
    );

    // Prepare headers with authentication (enhancedFetch handles cookies automatically)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...DEFAULT_HEADERS,
      ...this.defaultHeaders,
      ...requestHeaders,
    };

    const response = await enhancedFetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        variables: sentVariables,
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
