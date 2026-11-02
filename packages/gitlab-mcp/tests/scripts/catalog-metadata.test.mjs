import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const source = new URL('../../', import.meta.url);

// Prevent committed metadata from drifting when the actual registry adds or removes tools.
test('shipped metadata matches the current unfiltered catalog', () => {
  const { loadToolCatalog } = createRequire(import.meta.url)('../../dist/src/cli/tool-catalog.js');
  const { tools, metrics, readOnlyToolNames } = loadToolCatalog();
  const pkg = JSON.parse(readFileSync(new URL('package.json', source), 'utf8'));
  const server = JSON.parse(readFileSync(new URL('server.json', source), 'utf8'));
  assert.equal(pkg.mcp.description, metrics.description);
  assert.equal(server.description, metrics.description);
  assert.deepEqual(
    pkg.mcp.tools.map((tool) => tool.name),
    tools.map((tool) => tool.name),
  );
  const readOnly = new Set(readOnlyToolNames);
  for (const tool of pkg.mcp.tools) assert.equal(tool.readOnly, readOnly.has(tool.name));
  for (const location of ['README.md', '../../README.md', '../gitlab-mcp-db/README.md']) {
    const readme = readFileSync(new URL(location, source), 'utf8');
    assert(
      readme.includes(`${metrics.toolCount} tools across ${metrics.toolGroupCount} tool groups`),
    );
    assert(
      readme.includes(
        `${metrics.cqrsToolCount} CQRS tools with ${metrics.actionCount} typed actions and ${metrics.helperToolCount} setup helpers`,
      ),
    );
  }
});

function fixture(t, count) {
  const root = mkdtempSync(join(tmpdir(), 'gitlab-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'packages/gitlab-mcp');
  mkdirSync(join(root, 'tmp'));
  const put = (file, contents, executable = false) => {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents, { mode: executable ? 0o755 : 0o644 });
  };
  const tools = Array.from({ length: count }, (_, i) => ({
    name: `browse_fixture_${i}`,
    description: 'Fixture tool.',
    readOnly: true,
    tier: 'free',
  }));
  const metrics = {
    toolCount: count,
    cqrsToolCount: count,
    helperToolCount: 0,
    actionCount: count * 2,
    toolGroupCount: count,
    readonlyToolCount: count,
    description: `${count} tools, ${count * 2} typed actions, ${count} tool groups`,
  };
  const catalog = { tools, metrics };
  for (const script of ['prepare-release.sh', 'update-mcp-manifest.js', 'build-mcpb.sh'])
    put(
      `packages/gitlab-mcp/scripts/${script}`,
      readFileSync(new URL(`scripts/${script}`, source)),
      true,
    );
  put(
    'packages/gitlab-mcp/scripts/build-plugin-marketplace.sh',
    '#!/usr/bin/env bash\nexit 0\n',
    true,
  );
  put('packages/gitlab-mcp/catalog.json', JSON.stringify(catalog));
  put(
    'packages/gitlab-mcp/dist/src/cli/tool-catalog.js',
    'console.log(JSON.stringify(require("../../../catalog.json")));\n',
  );
  put('packages/gitlab-mcp/package.json', JSON.stringify({ name: 'fixture', version: '1.2.3' }));
  put(
    'packages/gitlab-mcp/server.json',
    JSON.stringify({ version: '1.2.3', packages: [{ version: '1.2.3' }] }),
  );
  put('packages/gitlab-mcp/README.md.in', readFileSync(new URL('README.md.in', source)));
  put(
    'packages/gitlab-mcp/mcpb/manifest.json.template',
    readFileSync(new URL('mcpb/manifest.json.template', source)),
  );
  put('packages/gitlab-mcp/plugin/assets/logo.png', 'fixture');
  put('packages/gitlab-mcp-db/dist/index.js', '');
  put('packages/gitlab-mcp-db/generated/index.js', '');
  put('packages/gitlab-mcp-db/package.json', '{"name":"fixture-db"}');
  put('node_modules/@prisma/client/index.js', '');
  // Package installation and database builds are outside this metadata contract test.
  put(
    'bin/npm',
    `#!${process.execPath}\nconst fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(join(root, 'npm-called'))}, 'called');
fs.mkdirSync('node_modules', {recursive:true});\n`,
    true,
  );
  put('bin/yarn', '#!/usr/bin/env bash\nexit 0\n', true);
  put('bin/bc', '#!/usr/bin/env bash\necho 0\n', true);
  return {
    root,
    project,
    catalog,
    run(script, extra = {}) {
      return spawnSync('bash', [`scripts/${script}`, '1.2.3'], {
        cwd: project,
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          TMPDIR: join(root, 'tmp'),
          PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`,
          ...extra,
        },
      });
    },
  };
}

// Different catalog sizes must update every release consumer, including both physical bundles.
for (const count of [2, 5])
  test(`release and both MCPB variants agree for ${count} fixture tools`, (t) => {
    const f = fixture(t, count);
    const prepared = f.run('prepare-release.sh');
    assert.equal(prepared.status, 0, prepared.stderr);
    const pkg = JSON.parse(readFileSync(join(f.project, 'package.json'), 'utf8'));
    assert.equal(pkg.mcp.description, f.catalog.metrics.description);
    assert.deepEqual(
      pkg.mcp.tools.map((tool) => tool.name),
      f.catalog.tools.map((tool) => tool.name),
    );
    assert.equal(
      JSON.parse(readFileSync(join(f.project, 'server.json'), 'utf8')).description,
      pkg.mcp.description,
    );
    for (const location of [
      'README.md',
      'packages/gitlab-mcp/README.md',
      'packages/gitlab-mcp-db/README.md',
    ]) {
      const readme = readFileSync(join(f.root, location), 'utf8');
      assert(readme.includes(`${count} tools across ${count} tool groups`));
      assert(
        readme.includes(`${count} CQRS tools with ${count * 2} typed actions and 0 setup helpers`),
      );
      assert(!/__\w+__/.test(readme));
    }
    for (const db of [false, true]) {
      const built = f.run('build-mcpb.sh', { MCPB_WITH_DB: String(db) });
      assert.equal(built.status, 0, built.stderr);
      const archive = join(f.project, `gitlab-mcp${db ? '-db' : ''}-1.2.3.mcpb`);
      const manifest = spawnSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' });
      assert.equal(manifest.status, 0, manifest.stderr);
      assert.equal(JSON.parse(manifest.stdout).description, pkg.mcp.description);
      const bundled = spawnSync('unzip', ['-p', archive, 'package.json'], { encoding: 'utf8' });
      assert.equal(bundled.status, 0, bundled.stderr);
      assert.equal(JSON.parse(bundled.stdout).mcp.description, pkg.mcp.description);
    }
  });

// Catalog failure must stop both entry points before changing metadata or installing dependencies.
test('registry loading failure aborts release and MCPB generation', (t) => {
  const f = fixture(t, 2);
  writeFileSync(
    join(f.project, 'dist/src/cli/tool-catalog.js'),
    'throw new Error("Fixture registry failure");',
  );
  const original = readFileSync(join(f.project, 'package.json'), 'utf8');
  for (const script of ['prepare-release.sh', 'build-mcpb.sh']) {
    const result = f.run(script);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Fixture registry failure/);
    assert.equal(readFileSync(join(f.project, 'package.json'), 'utf8'), original);
    assert.equal(existsSync(join(f.root, 'npm-called')), false);
  }
});
