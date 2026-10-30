import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import {
  ResultSchema,
  ErrorCode,
  McpError,
  SetLevelRequestSchema,
  type Request,
  type Notification,
  type Result,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { Connections, type Backend } from './connections';
import { connectionPanel, CONNECTION_PANEL_META, CONNECTION_PANEL_URI } from './panel';
import { MCP_APPS_EXTENSION } from '../mcp-apps';

const PREFIX = 'gitlab_plugin_';
const EMPTY_INPUT = { type: 'object' as const, properties: {}, additionalProperties: false };
const OBJECT_OUTPUT = { type: 'object' as const, additionalProperties: true };
const ConnectionAction = z.object({
  action: z.enum(['status', 'connect', 'reconnect', 'cancel', 'disconnect']),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  connection: z.unknown().optional(),
});
const tools: Tool[] = [
  {
    name: PREFIX + 'open_connection',
    description:
      'Open private GitLab connection setup. Choose local GitLab or an existing MCP server.',
    inputSchema: EMPTY_INPUT,
    _meta: { ui: { resourceUri: CONNECTION_PANEL_URI } },
  },
  {
    name: PREFIX + 'connection',
    description: 'Manage this plugin connection from the private setup panel.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { enum: [...ConnectionAction.shape.action.options] },
        revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        connection: { type: 'object' },
      },
      required: ['action', 'revision'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: PREFIX + 'get_settings',
    description: 'Read plugin connection and backend account settings.',
    inputSchema: EMPTY_INPUT,
    outputSchema: OBJECT_OUTPUT,
  },
  {
    name: PREFIX + 'update_settings',
    description: 'Update backend account settings.',
    inputSchema: { type: 'object', properties: { set: { type: 'object' } }, required: ['set'] },
    outputSchema: OBJECT_OUTPUT,
  },
];

const result = (value: Record<string, unknown>): Result => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: value,
});

/** Public MCP bridge; GitLab behavior and account authority stay at the selected backend. */
export function createPluginServer(
  connections: Connections,
): Server<Request, Notification, Result> {
  const server = new Server<Request, Notification, Result>(
    { name: 'gitlab-mcp-plugin', version: '1.0.0' },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
        extensions: MCP_APPS_EXTENSION,
        prompts: { listChanged: true },
        logging: {},
        experimental: {
          'openai/settings': {
            readTool: PREFIX + 'get_settings',
            updateTool: PREFIX + 'update_settings',
          },
        },
      },
      instructions:
        'Use gitlab_plugin_open_connection to configure or reconnect GitLab. Credentials belong only in the private connection panel, never in chat. GitLab tools appear after connecting.',
    },
  );
  connections.changed = () => {
    void server.notification({ method: 'notifications/tools/list_changed' }).catch(() => {});
    void server.notification({ method: 'notifications/resources/list_changed' }).catch(() => {});
    void server.notification({ method: 'notifications/prompts/list_changed' }).catch(() => {});
  };
  connections.wire = (backend) => {
    backend.client.fallbackRequestHandler = (request, extra) => {
      if (connections.active !== backend)
        throw new McpError(ErrorCode.InvalidRequest, 'The connection is no longer active.');
      return server.request(request, ResultSchema, { signal: extra.signal });
    };
    backend.client.fallbackNotificationHandler = async (notification) => {
      if (connections.active === backend) await server.notification(notification);
    };
  };
  server.oninitialized = () => {
    connections.capabilities = server.getClientCapabilities() ?? {};
  };
  server.setRequestHandler(SetLevelRequestSchema, async (request, extra) => {
    const backend = await connections.ready();
    return backend?.client.getServerCapabilities()?.logging
      ? forward(backend, request, extra, connections)
      : {};
  });
  server.fallbackNotificationHandler = async (notification) => {
    const backend = await connections.ready();
    if (backend) await backend.client.notification(notification);
  };
  server.fallbackRequestHandler = async (request, extra) => {
    const params = request.params ?? {};
    if (
      request.method === 'tools/call' &&
      typeof params.name === 'string' &&
      params.name.startsWith(PREFIX)
    ) {
      return localTool(params.name, params.arguments, connections, extra);
    }
    if (request.method === 'resources/read' && params.uri === CONNECTION_PANEL_URI) {
      return {
        contents: [
          {
            uri: CONNECTION_PANEL_URI,
            mimeType: 'text/html;profile=mcp-app',
            text: connectionPanel(),
            _meta: CONNECTION_PANEL_META,
          },
        ],
      };
    }
    const backend = await connections.ready();
    if (request.method === 'tools/list') return toolListing(backend, request, extra, connections);
    if (request.method === 'resources/list')
      return resourceListing(backend, request, extra, connections);
    if (request.method === 'prompts/list' && !backend?.client.getServerCapabilities()?.prompts)
      return { prompts: [] };
    if (!backend)
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Open GitLab connection settings to connect or reconnect.',
      );
    return forward(backend, request, extra, connections);
  };
  return server;
}

async function toolListing(
  backend: Backend | undefined,
  request: Request,
  extra: RequestHandlerExtra<Request, Notification>,
  connections: Connections,
): Promise<Result> {
  const response = backend ? await forward(backend, request, extra, connections) : { tools: [] };
  const offered = response.tools as Tool[];
  if (offered.some((tool) => tool.name.startsWith(PREFIX)))
    throw new McpError(ErrorCode.InvalidRequest, 'Backend uses reserved plugin tool names.');
  return {
    ...response,
    tools: request.params?.cursor !== undefined ? offered : [...tools, ...offered],
  };
}

async function resourceListing(
  backend: Backend | undefined,
  request: Request,
  extra: RequestHandlerExtra<Request, Notification>,
  connections: Connections,
): Promise<Result> {
  const response = backend?.client.getServerCapabilities()?.resources
    ? await forward(backend, request, extra, connections)
    : { resources: [] };
  return {
    ...response,
    resources:
      request.params?.cursor !== undefined
        ? response.resources
        : [
            {
              uri: CONNECTION_PANEL_URI,
              name: 'GitLab connection',
              mimeType: 'text/html;profile=mcp-app',
              _meta: CONNECTION_PANEL_META,
            },
            ...(response.resources as unknown[]),
          ],
  };
}

async function forward(
  backend: Backend,
  request: Request,
  extra: RequestHandlerExtra<Request, Notification>,
  connections: Connections,
): Promise<Result> {
  const token = request.params?._meta?.progressToken;
  const response = await backend.client
    .request(request, ResultSchema, {
      signal: extra.signal,
      ...(token !== undefined
        ? {
            onprogress: (progress) => {
              void extra
                .sendNotification({
                  method: 'notifications/progress',
                  params: { ...progress, progressToken: token },
                })
                .catch(() => {});
            },
          }
        : {}),
    })
    .catch((error: unknown) => {
      // JSON-RPC errors belong to the backend contract. Transport errors can quote HTTP bodies or credentials.
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        'The connection request failed. Its outcome may be unknown. Check connection settings before retrying; do not repeat writes automatically.',
      );
    });
  if (
    connections.active !== backend ||
    connections.store.revision() !== backend.snapshot.revision
  ) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Connection changed while this request was running. Its outcome may be unknown. Do not repeat writes automatically.',
    );
  }
  return response;
}

async function connectionAction(raw: unknown, connections: Connections): Promise<Result> {
  const parsed = ConnectionAction.safeParse(raw);
  if (!parsed.success) {
    const revision = parsed.error.issues.some(
      (issue) => issue.path.length === 0 || issue.path[0] === 'revision',
    );
    throw new McpError(
      ErrorCode.InvalidParams,
      revision ? 'Invalid connection revision.' : 'Unknown connection action.',
    );
  }
  const args = parsed.data;
  switch (args.action) {
    case 'status':
      await connections.ready();
      break;
    case 'connect':
      return result(await connections.connect(args.connection, args.revision));
    case 'reconnect': {
      const saved = connections.store.read();
      if (!saved.connection)
        throw new McpError(ErrorCode.InvalidParams, 'Configure a connection first.');
      const { authorization: _authorization, ...input } = saved.connection;
      return result(await connections.connect(input, args.revision));
    }
    case 'disconnect':
      await connections.disconnect(args.revision);
      break;
    case 'cancel':
      await connections.cancel();
      break;
  }
  return result(connections.status());
}

async function connectionSettings(
  backend: Backend | undefined,
  connections: Connections,
  extra: RequestHandlerExtra<Request, Notification>,
): Promise<Result> {
  let unavailable = false;
  let page: Record<string, unknown> = {
    schema: { type: 'object', properties: {}, required: [] },
    values: {},
    layout: [],
  };
  if (backend) {
    try {
      const response = await forward(
        backend,
        { method: 'tools/call', params: { name: 'get_settings', arguments: {} } },
        extra,
        connections,
      );
      if (response.isError) unavailable = true;
      else if (response.structuredContent)
        page = response.structuredContent as Record<string, unknown>;
    } catch {
      // Local reconnection controls remain available when backend settings cannot be read.
      unavailable = true;
    }
  }
  return result({
    ...page,
    layout: [
      {
        kind: 'group',
        title: 'Connection',
        items: [
          {
            kind: 'tool',
            tool: PREFIX + 'open_connection',
            description: unavailable
              ? 'Backend account settings are unavailable. Set up, change or reconnect GitLab.'
              : 'Set up, change or reconnect GitLab',
          },
        ],
      },
      ...(page.layout as unknown[]),
    ],
  });
}

async function localTool(
  name: string,
  raw: unknown,
  connections: Connections,
  extra: RequestHandlerExtra<Request, Notification>,
): Promise<Result> {
  if (name === PREFIX + 'open_connection')
    return {
      content: [{ type: 'text', text: 'Configure your connection in the private panel.' }],
      _meta: { ui: { resourceUri: CONNECTION_PANEL_URI } },
    };
  if (name === PREFIX + 'connection') return connectionAction(raw, connections);
  const backend = await connections.ready();
  if (name === PREFIX + 'get_settings') return connectionSettings(backend, connections, extra);
  if (name === PREFIX + 'update_settings' && backend)
    return forward(
      backend,
      {
        method: 'tools/call',
        params: { name: 'update_settings', arguments: raw as Record<string, unknown> },
      },
      extra,
      connections,
    );
  throw new McpError(ErrorCode.InvalidRequest, 'Connect GitLab before changing account settings.');
}
