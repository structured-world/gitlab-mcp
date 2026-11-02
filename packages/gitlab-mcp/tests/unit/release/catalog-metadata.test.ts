import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');

// Both public registries must describe the same catalog, rather than different category counters.
test('npm and MCP Registry descriptions report identical catalog metrics', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const server = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
  expect(pkg.mcp.description).toBe(server.description);
});

// Setup helpers are part of the total, but must not be advertised as action-based CQRS tools.
test('the README distinguishes the full catalog from CQRS tools', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  expect(readme).not.toContain(`${pkg.mcp.tools.length} CQRS tools`);
  expect(readme).toContain('tool groups');
});
