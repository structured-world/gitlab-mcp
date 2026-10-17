/**
 * Renders the plugin listing images under plugin/assets/: the composer icons from
 * their SVG sources, and screenshots of the GitLab connection panel.
 *
 * The screenshots show the panel document the server serves, in a minimal MCP Apps
 * host that answers its tool calls with demo data for gitlab.example.com. The demo
 * answers are checked against the tools' output schemas first, so they have the shape
 * the server returns.
 *
 * Needs the compiled CLI (yarn build), rsvg-convert and Google Chrome.
 * Usage: node scripts/plugin-assets.mjs [--chrome <path to Chrome>]
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import crossSpawn from 'cross-spawn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'plugin', 'assets');
const require = createRequire(import.meta.url);
const dist = (path) => require(join(root, 'dist', 'src', path));

const chromeAt = process.argv.indexOf('--chrome');
const chrome =
  chromeAt === -1
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.argv[chromeAt + 1];

function run(command, args) {
  const result = crossSpawn.sync(command, args, { encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr}`);
  }
}

/**
 * Takes one screenshot with headless Chrome, without blocking, so this process can serve
 * the page it loads. Success is the file written anew: Chrome can exit non-zero when its
 * shutdown watchdog fires after the screenshot is already saved.
 */
function screenshot(url, file, height, profile) {
  rmSync(file, { force: true });
  return new Promise((resolve, reject) => {
    const child = crossSpawn(
      chrome,
      [
        '--headless=new',
        `--user-data-dir=${profile}`,
        '--hide-scrollbars',
        '--force-device-scale-factor=2',
        `--window-size=768,${height}`,
        '--virtual-time-budget=6000',
        `--screenshot=${file}`,
        url,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      if (existsSync(file)) resolve();
      else reject(new Error(`Chrome wrote no screenshot to ${file}: ${stderr}`));
    });
  });
}

// ---- Composer icons ----
// 96 px keeps the glyph sharp at twice its usual composer size.
for (const name of ['composer-icon', 'composer-icon-dark']) {
  run('rsvg-convert', [
    '-w',
    '96',
    '-h',
    '96',
    '-o',
    join(assets, `${name}.png`),
    join(assets, `${name}.svg`),
  ]);
}

// ---- Demo answers for the panel ----
const { settingsPanelHtml, MCP_APPS_PROTOCOL_VERSION } = dist('entities/context/settings-panel.js');
const { contextToolRegistry } = dist('entities/context/registry.js');
const { TOOL_GROUPS } = dist('configuration/groups.js');

const INSTANCE = 'https://gitlab.example.com';
const disabledGroups = ['access_tokens', 'audit_events', 'runners'];
const properties = {
  preset: {
    type: 'string',
    title: 'Working preset',
    description: 'Which tools and actions your chats work with.',
    enum: ['none', 'developer', 'reviewer', 'readonly'],
  },
  readOnly: {
    type: 'boolean',
    title: 'Read-only',
    description: 'Only read from GitLab: tools that change anything are turned off.',
  },
  scope: { type: 'string', title: 'Default project or group', maxLength: 255 },
  scopeIncludeSubgroups: { type: 'boolean', title: 'Include subgroups' },
};
const values = {
  preset: 'developer',
  readOnly: false,
  scope: 'platform',
  scopeIncludeSubgroups: true,
};
for (const group of TOOL_GROUPS) {
  properties[`tools_${group.id}`] = { type: 'boolean', title: group.title };
  values[`tools_${group.id}`] = !disabledGroups.includes(group.id);
}

const context = {
  host: 'gitlab.example.com',
  apiUrl: INSTANCE,
  presetName: 'developer',
  readOnly: false,
  disabledToolGroups: disabledGroups,
  scope: { type: 'group', path: 'platform', includeSubgroups: true, detected: true },
  oauthMode: true,
};

const answers = {
  get_settings: {
    schema: { type: 'object', properties, required: Object.keys(properties) },
    values,
    layout: [],
  },
  manage_context: { action: 'show', data: context },
  check_connection: {
    account: 'arivera',
    instance: INSTANCE,
    gitlabVersion: '18.4.0',
    tier: 'ultimate',
    authenticated: true,
    reachable: true,
    readOnly: false,
    preset: 'developer',
    scope: 'group platform and its subgroups',
    availableTools: 34,
    warnings: [],
    recommendations: [],
  },
  find_scope_targets: {
    targets: [
      { type: 'group', path: 'platform', name: 'Platform' },
      { type: 'project', path: 'platform/api-gateway', name: 'Platform / API Gateway' },
      { type: 'project', path: 'platform/billing', name: 'Platform / Billing' },
      { type: 'group', path: 'platform/infrastructure', name: 'Platform / Infrastructure' },
    ],
  },
};

const ajv = new Ajv({ strict: false, allErrors: true });
for (const [tool, answer] of Object.entries(answers)) {
  const schema = contextToolRegistry.get(tool)?.outputSchema;
  if (!schema) throw new Error(`${tool} declares no output schema`);
  if (!ajv.validate(schema, answer)) {
    throw new Error(`Demo answer for ${tool} does not match its schema: ${ajv.errorsText()}`);
  }
}

// ---- Host page ----
// The panel fills the window less its margins, so a screenshot never depends on when the
// panel reports its size; each height fits that scene's panel content.
const SCENES = [
  { file: 'screenshot-1.png', theme: 'light', search: '', height: 874 },
  { file: 'screenshot-2.png', theme: 'dark', search: 'plat', height: 1002 },
];

/** JSON for an inline script: "</" is escaped so the value cannot close the script element. */
function scriptJson(value) {
  return JSON.stringify(value).replaceAll('</', String.raw`<\/`);
}

function hostPage({ theme, search }) {
  const panel = scriptJson(settingsPanelHtml());
  const background = theme === 'dark' ? '#212121' : '#f4f4f5';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: ${background}; }
iframe { display: block; width: 720px; height: calc(100vh - 48px); margin: 24px auto; border: 0;
  border-radius: 12px; }
</style></head><body><script>
const ANSWERS = ${scriptJson(answers)};
const frame = document.createElement('iframe');
frame.srcdoc = ${panel};
document.body.appendChild(frame);
function reply(id, result) { frame.contentWindow.postMessage({ jsonrpc: '2.0', id, result }, '*'); }
function typeSearch() {
  const doc = frame.contentDocument;
  const input = doc.getElementById('search');
  input.value = ${scriptJson(search)};
  input.dispatchEvent(new Event('input'));
  // The panel searches 300 ms after the last keystroke.
  setTimeout(() => doc.querySelector('#results li')?.click(), 800);
}
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message.method === 'ui/initialize') {
    reply(message.id, {
      protocolVersion: ${scriptJson(MCP_APPS_PROTOCOL_VERSION)},
      hostCapabilities: { serverTools: {} },
      hostContext: { theme: ${scriptJson(theme)} },
    });
  } else if (message.method === 'tools/call') {
    const answer = ANSWERS[message.params.name];
    reply(message.id, { content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer });
  } else if (message.method === 'ui/notifications/initialized' && ${scriptJson(search)}) {
    setTimeout(typeSearch, 200);
  }
});
</script></body></html>`;
}

// Pages are addressed by scene number only, so no request value reaches the HTML.
const pages = new Map(SCENES.map((scene, index) => [`/${index}`, hostPage(scene)]));
const server = createServer((request, response) => {
  const page = pages.get(new URL(request.url, 'http://127.0.0.1').pathname);
  response.writeHead(page === undefined ? 404 : 200, {
    'content-type': 'text/html; charset=utf-8',
  });
  response.end(page ?? '');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const profiles = mkdtempSync(join(tmpdir(), 'plugin-assets-chrome-'));

try {
  // Each run has its own profile, apart from the others and from the user's Chrome.
  await Promise.all(
    SCENES.map(async (scene, index) => {
      const url = `http://127.0.0.1:${server.address().port}/${index}`;
      await screenshot(url, join(assets, scene.file), scene.height, join(profiles, `${index}`));
      console.log(`Rendered ${scene.file}`);
    }),
  );
} finally {
  server.close();
  rmSync(profiles, { recursive: true, force: true });
}
