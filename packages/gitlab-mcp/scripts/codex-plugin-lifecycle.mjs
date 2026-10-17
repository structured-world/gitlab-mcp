/**
 * Installs a built plugin package into a real Codex CLI and walks it through
 * install, disable, enable, upgrade, reinstall and uninstall. Codex runs with its
 * own HOME and CODEX_HOME, seeded with unrelated settings and Claude data that
 * every step must leave untouched.
 *
 * Usage: node scripts/codex-plugin-lifecycle.mjs --codex <codex executable> <plugin build output>
 */

import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import crossSpawn from 'cross-spawn';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

const PLUGIN_NAME = 'gitlab-mcp';

function parseArgs(argv) {
  const codexAt = argv.indexOf('--codex');
  const codex = codexAt === -1 ? 'codex' : argv[codexAt + 1];
  const rest = codexAt === -1 ? argv : argv.filter((_, i) => i !== codexAt && i !== codexAt + 1);
  if (!codex || rest.length !== 1) {
    throw new Error(
      'Usage: codex-plugin-lifecycle.mjs --codex <codex executable> <plugin build output>',
    );
  }
  return { codex, source: resolve(rest[0]) };
}

/** Every file below a directory as relative path -> bytes. */
function snapshot(directory) {
  const files = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(directory, path), readFileSync(path));
    }
  };
  walk(directory);
  return files;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const { codex, source } = parseArgs(process.argv.slice(2));
const root = mkdtempSync(join(tmpdir(), 'codex-plugin-lifecycle-'));
const home = join(root, 'home');
const codexHome = join(home, '.codex');
const configPath = join(codexHome, 'config.toml');
const marketplace = join(root, 'marketplace');
const pluginSource = join(marketplace, 'plugins', PLUGIN_NAME);
const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome };

function run(...args) {
  // cross-spawn runs npm's codex.cmd shim on Windows without a shell.
  const result = crossSpawn.sync(codex, args, { env, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codex ${args.join(' ')} exited with ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

function servers() {
  return JSON.parse(run('mcp', 'list', '--json'));
}

function readConfig() {
  return parseToml(readFileSync(configPath, 'utf8'));
}

function setPluginEnabled(pluginId, enabled) {
  // The Codex app toggles a plugin by this config.toml field; the CLI has no command for it.
  const config = readConfig();
  config.plugins[pluginId].enabled = enabled;
  writeFileSync(configPath, stringifyToml(config));
}

function installedVersions() {
  const directory = join(codexHome, 'plugins', 'cache', marketplaceName, PLUGIN_NAME);
  return existsSync(directory) ? readdirSync(directory).sort() : [];
}

function assertUnrelatedStateKept() {
  const config = readConfig();
  assert.equal(config.model, 'o3', 'an unrelated setting changed');
  assert.equal(config.mcp_servers?.other?.command, 'other-server', 'an unrelated server changed');
  for (const [path, bytes] of claudeFiles) {
    assert.deepEqual(readFileSync(path), bytes, `${path} changed`);
  }
}

function step(name) {
  console.log(`- ${name}`);
}

// The package under test is copied, so the simulated upgrade never edits the build output.
cpSync(source, marketplace, { recursive: true });
const marketplaceName = readJson(join(marketplace, '.agents', 'plugins', 'marketplace.json')).name;
const pluginId = `${PLUGIN_NAME}@${marketplaceName}`;
const manifest = readJson(join(pluginSource, 'plugin.json'));
// The package declares one server; Codex lists it under that key.
const [[SERVER_NAME, { url: endpoint }]] = Object.entries(
  readJson(join(pluginSource, 'mcp.json')).mcpServers,
);

mkdirSync(join(home, '.claude'), { recursive: true });
mkdirSync(codexHome, { recursive: true });
writeFileSync(configPath, 'model = "o3"\n\n[mcp_servers.other]\ncommand = "other-server"\n');
const claudeFiles = new Map([
  [join(home, '.claude.json'), Buffer.from('{"mcpServers":{"gitlab":{"command":"npx"}}}\n')],
  [join(home, '.claude', 'settings.json'), Buffer.from('{"theme":"dark"}\n')],
]);
for (const [path, bytes] of claudeFiles) writeFileSync(path, bytes);

try {
  step('add the marketplace');
  run('plugin', 'marketplace', 'add', marketplace);

  step('install');
  const installed = JSON.parse(run('plugin', 'add', pluginId, '--json'));
  assert.equal(installed.version, manifest.version);
  // The installed copy, not the source tree, is what users run: it must match file for file.
  assert.deepEqual(snapshot(installed.installedPath), snapshot(pluginSource));
  const server = servers().find((s) => s.name === SERVER_NAME);
  assert.deepEqual(server?.transport?.type, 'streamable_http');
  assert.equal(server.transport.url, endpoint);
  assertUnrelatedStateKept();

  step('disable and enable');
  setPluginEnabled(pluginId, false);
  assert.equal(
    servers().some((s) => s.name === SERVER_NAME),
    false,
    'a disabled plugin still runs',
  );
  setPluginEnabled(pluginId, true);
  assert.equal(
    servers().some((s) => s.name === SERVER_NAME),
    true,
    'an enabled plugin does not run',
  );

  step('a global entry of the same name hides the plugin server');
  // gitlab-mcp install --codex warns about this; it must hold for the warning to be true.
  run('mcp', 'add', SERVER_NAME, '--', 'gitlab-mcp');
  const shadowed = servers().filter((s) => s.name === SERVER_NAME);
  assert.equal(shadowed.length, 1, 'Codex runs both the global entry and the plugin server');
  assert.equal(shadowed[0].transport.type, 'stdio');
  run('mcp', 'remove', SERVER_NAME);
  assert.equal(servers().find((s) => s.name === SERVER_NAME)?.transport?.url, endpoint);

  step('upgrade');
  const [major, minor, patch] = manifest.version.split(/[.+-]/).map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  writeFileSync(
    join(pluginSource, 'plugin.json'),
    JSON.stringify({ ...manifest, version: next }, null, 2),
  );
  assert.equal(JSON.parse(run('plugin', 'add', pluginId, '--json')).version, next);
  assert.deepEqual(installedVersions(), [next], 'the previous version stayed in the cache');
  assertUnrelatedStateKept();

  step('reinstall');
  assert.equal(JSON.parse(run('plugin', 'add', pluginId, '--json')).version, next);
  assert.deepEqual(installedVersions(), [next]);
  assert.equal(servers().filter((s) => s.name === SERVER_NAME).length, 1, 'tools are listed twice');

  step('uninstall');
  run('plugin', 'remove', pluginId);
  assert.deepEqual(installedVersions(), [], 'the plugin cache stayed');
  assert.equal(
    Object.hasOwn(readConfig().plugins ?? {}, pluginId),
    false,
    'the plugin stayed configured',
  );
  assert.equal(
    servers().some((s) => s.name === SERVER_NAME),
    false,
    'the plugin server still runs',
  );
  assertUnrelatedStateKept();

  console.log(`Codex plugin lifecycle passed for ${pluginId} ${manifest.version} -> ${next}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
