/** MCP Apps (SEP-1865): the extension under which ui:// resources render as interactive views. */

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Server capability declaring MCP Apps. Extensions are negotiated (SEP-1724): a host renders
 * ui:// resources only from a server that declares the extension with their MIME type.
 */
export const MCP_APPS_EXTENSION = {
  'io.modelcontextprotocol/ui': { mimeTypes: [MCP_APP_MIME_TYPE] },
};
