/**
 * MCP Client Interface and error classes for testing
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

export interface MCPClientInterface {
  /**
   * Connect to MCP server
   */

  connect(connectionString: string, options?: Record<string, unknown>): Promise<void>;

  /**
   * Disconnect from server
   */
  disconnect(): Promise<void>;

  /**
   * List available tools from server
   */
  listTools(): Promise<ListToolsResult>;

  /**
   * Call a tool on the server
   */

  callTool(name: string, arguments_?: Record<string, unknown>): Promise<CallToolResult>;

  /**
   * Test connection by listing tools
   */
  testConnection(): Promise<boolean>;

  /**
   * Get client connection status
   */
  get isConnected(): boolean;
}

/**
 * Base error class for MCP client errors
 */
export class MCPClientError extends Error {
  constructor(
    message: string,

    public readonly _cause?: Error,
  ) {
    super(message);
    this.name = 'MCPClientError';
  }
}

/**
 * Connection error for MCP clients
 */
export class MCPConnectionError extends MCPClientError {
  constructor(message: string, _cause?: Error) {
    super(message, _cause);
    this.name = 'MCPConnectionError';
  }
}

/**
 * Tool call error for MCP clients
 */
export class MCPToolCallError extends MCPClientError {
  constructor(
    message: string,

    public readonly _toolName?: string,
    _cause?: Error,
  ) {
    super(message, _cause);
    this.name = 'MCPToolCallError';
  }
}

/**
 * Shared MCP test-client behavior. Subclasses only provide the transport: the
 * connect/disconnect/listTools/callTool/testConnection lifecycle is identical
 * across stdio / SSE / streamable-http.
 */
export abstract class BaseTestClient implements MCPClientInterface {
  protected readonly client: Client;
  protected transport: Transport | null = null;
  /** Human-readable transport name used in connection error messages. */
  protected abstract readonly transportLabel: string;

  constructor() {
    this.client = new Client({ name: 'test-client', version: '1.0.0' });
  }

  /** Build the transport for this client's protocol (the only per-client part). */
  protected abstract createTransport(
    connectionString: string,
    options?: Record<string, unknown>,
  ): Transport;

  async connect(connectionString: string, options?: Record<string, unknown>): Promise<void> {
    if (this.transport) {
      throw new MCPConnectionError('Client is already connected');
    }
    try {
      this.transport = this.createTransport(connectionString, options);
      await this.client.connect(this.transport);
    } catch (error) {
      this.transport = null;
      throw new MCPConnectionError(
        `Failed to connect to ${this.transportLabel} server: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        console.warn('Warning during disconnect:', error);
      } finally {
        this.transport = null;
      }
    }
  }

  async listTools(): Promise<ListToolsResult> {
    if (!this.transport) {
      throw new MCPConnectionError('Client is not connected');
    }
    try {
      return await this.client.listTools();
    } catch (error) {
      throw new MCPToolCallError(
        `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
        'listTools',
        error instanceof Error ? error : undefined,
      );
    }
  }

  async callTool(name: string, arguments_: Record<string, unknown> = {}): Promise<CallToolResult> {
    if (!this.transport) {
      throw new MCPConnectionError('Client is not connected');
    }
    try {
      return (await this.client.callTool({ name, arguments: arguments_ })) as CallToolResult;
    } catch (error) {
      throw new MCPToolCallError(
        `Failed to call tool '${name}': ${error instanceof Error ? error.message : String(error)}`,
        name,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const tools = await this.listTools();
      return Array.isArray(tools.tools) && tools.tools.length > 0;
    } catch {
      return false;
    }
  }

  get isConnected(): boolean {
    return this.transport !== null;
  }
}
