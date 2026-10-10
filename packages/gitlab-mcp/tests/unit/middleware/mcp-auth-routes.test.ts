/**
 * The OAuth check runs exactly once per MCP transport request, on the request's own path,
 * and never on other routes. Mounted with `app.use`, the check saw `req.path` stripped to
 * `/` on `/mcp`, `/sse` and `/messages`, and derived the root resource for all of them.
 */

import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import {
  authenticateMcpTransports,
  MCP_TRANSPORT_PATHS,
} from '../../../src/middleware/mcp-auth-routes';

describe('authenticateMcpTransports', () => {
  let server: http.Server;
  let baseUrl: string;
  const seen: string[] = [];

  beforeAll(async () => {
    const app = express();
    authenticateMcpTransports(app, (req, _res, next) => {
      seen.push(req.path);
      next();
    });
    app.all([...MCP_TRANSPORT_PATHS, '/other'], (_req, res) => {
      res.status(204).end();
    });
    server = http.createServer(app as http.RequestListener);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen.length = 0;
  });

  it.each(MCP_TRANSPORT_PATHS)('authenticates %s once, on its own path', async (path) => {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST' });

    expect(response.status).toBe(204);
    expect(seen).toEqual([path]);
  });

  it('leaves other routes alone', async () => {
    const response = await fetch(`${baseUrl}/other`, { method: 'POST' });

    expect(response.status).toBe(204);
    expect(seen).toEqual([]);
  });
});
