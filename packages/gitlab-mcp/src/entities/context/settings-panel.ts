/**
 * The settings panel: an MCP App (ui:// resource) for choosing where to work, previewing
 * what the connection can do and recovering from connection problems.
 *
 * It talks only to its host over the MCP Apps bridge and only to this server's tools; it
 * makes no network request of its own (empty CSP) and shows GitLab strings as text only.
 * Saving goes through the same tools as every other client, so the panel never has an
 * effect a direct tool call could not have.
 */

import { packageVersion } from '../../config';

export const SETTINGS_PANEL_URI = 'ui://gitlab-mcp/settings-panel-v1.html';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
/** MCP Apps protocol version the panel speaks. */
export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';

/** Resource metadata: no network origins at all, and a host border around the panel. */
export const SETTINGS_PANEL_RESOURCE_META = {
  ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, prefersBorder: true },
};

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: var(--color-background-primary, #ffffff);
  --bg-muted: var(--color-background-secondary, #f4f5f7);
  --text: var(--color-text-primary, #1f2328);
  --text-muted: var(--color-text-secondary, #59636e);
  --border: var(--color-border-primary, #d1d9e0);
  --ring: var(--color-ring-primary, #2f6feb);
  --danger: var(--color-text-danger, #c62828);
  --success: var(--color-text-success, #1a7f37);
  --warning: var(--color-text-warning, #9a6700);
  --radius: var(--border-radius-md, 8px);
  --font: var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
}
:root[data-theme="dark"] {
  --bg: var(--color-background-primary, #0d1117);
  --bg-muted: var(--color-background-secondary, #161b22);
  --text: var(--color-text-primary, #e6edf3);
  --text-muted: var(--color-text-secondary, #9198a1);
  --border: var(--color-border-primary, #3d444d);
  --danger: var(--color-text-danger, #f47067);
  --success: var(--color-text-success, #57ab5a);
  --warning: var(--color-text-warning, #c69026);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: var(--color-background-primary, #0d1117);
    --bg-muted: var(--color-background-secondary, #161b22);
    --text: var(--color-text-primary, #e6edf3);
    --text-muted: var(--color-text-secondary, #9198a1);
    --border: var(--color-border-primary, #3d444d);
    --danger: var(--color-text-danger, #f47067);
    --success: var(--color-text-success, #57ab5a);
    --warning: var(--color-text-warning, #c69026);
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--text);
  font: 14px/1.45 var(--font); }
h1 { font-size: 16px; margin: 0 0 4px; }
h2 { font-size: 14px; margin: 0 0 8px; }
section { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px;
  margin-top: 12px; }
.muted { color: var(--text-muted); }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
label { font-weight: 600; display: block; margin-bottom: 4px; }
input[type="search"] { width: 100%; padding: 8px; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--bg); color: var(--text); font: inherit; }
button { padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-muted); color: var(--text); font: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { border-color: var(--ring); }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
ul.results { list-style: none; margin: 8px 0 0; padding: 0; max-height: 240px;
  overflow-y: auto; }
ul.results li { padding: 6px 8px; border-radius: var(--radius); cursor: pointer; }
ul.results li[aria-selected="true"] { background: var(--bg-muted); outline: 1px solid var(--ring); }
.kind { font-size: 12px; color: var(--text-muted); margin-left: 6px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
dt { color: var(--text-muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.status-ok { color: var(--success); }
.status-error { color: var(--danger); }
.status-warning { color: var(--warning); }
#notice:empty { display: none; }
#notice { margin-top: 12px; padding: 8px; border-radius: var(--radius); background: var(--bg-muted); }
ul.plain { margin: 4px 0 0; padding-left: 18px; }
@media (max-width: 420px) { body { padding: 8px; } dl { grid-template-columns: 1fr; } }
`;

// Raw: the escapes below belong to the browser script, not to this module.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var PROTOCOL = '${MCP_APPS_PROTOCOL_VERSION}';
  var VERSION = '${packageVersion}';
  var REQUEST_TIMEOUT_MS = 30000;
  var nextId = 1;
  var pending = {};
  var state = { settings: null, context: null, selected: null, query: '', results: [], busy: false };

  function el(id) { return document.getElementById(id); }
  function text(node, value) { node.textContent = value == null ? '' : String(value); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function announce(message, kind) {
    var notice = el('notice');
    notice.className = kind ? 'status-' + kind : '';
    text(notice, message);
  }

  // ---- MCP Apps bridge (JSON-RPC over postMessage with the host) ----
  function post(message) { window.parent.postMessage(message, '*'); }
  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: '2.0', id: id, method: method, params: params });
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error('The app host did not answer'));
      }, REQUEST_TIMEOUT_MS);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
    });
  }
  function notify(method, params) { post({ jsonrpc: '2.0', method: method, params: params || {} }); }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.method === undefined && message.id !== undefined && pending[message.id]) {
      var entry = pending[message.id];
      delete pending[message.id];
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || 'Request failed'));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/host-context-changed') applyHostContext(message.params);
    if (message.method === 'ui/resource-teardown' && message.id !== undefined) {
      post({ jsonrpc: '2.0', id: message.id, result: {} });
    }
  });

  function applyHostContext(context) {
    if (!context) return;
    if (context.theme === 'light' || context.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', context.theme);
    }
    var variables = context.styles && context.styles.variables;
    if (variables) {
      Object.keys(variables).forEach(function (name) {
        if (name.indexOf('--') === 0 && typeof variables[name] === 'string') {
          document.documentElement.style.setProperty(name, variables[name]);
        }
      });
    }
  }

  function toolText(result) {
    var parts = (result && result.content) || [];
    return parts.filter(function (p) { return p.type === 'text'; })
      .map(function (p) { return p.text; }).join('\n');
  }

  function callTool(name, args) {
    return request('tools/call', { name: name, arguments: args || {} }).then(function (result) {
      if (result && result.isError) {
        var error = new Error(toolText(result) || 'The tool failed');
        error.toolError = true;
        throw error;
      }
      return (result && result.structuredContent) || {};
    });
  }

  // ---- Problems a user can act on ----
  function explain(error) {
    var message = (error && error.message) || String(error);
    if (/invalid_token|re-authenticate|401|sign in again|no longer accepts/i.test(message)) {
      return 'Your GitLab sign-in expired or was revoked. Reconnect GitLab from the app’s connection settings, then open this panel again.';
    }
    if (/CONNECTION_FAILED|unreachable|ECONNREFUSED|timed out|temporarily unavailable/i.test(message)) {
      return 'GitLab is not reachable right now. Your saved settings still apply; try again in a moment.';
    }
    if (/did not answer/.test(message)) {
      return 'The app host stopped answering. Close and reopen this panel.';
    }
    return message;
  }

  // ---- Rendering (GitLab strings only ever go through textContent) ----
  function describeScope(scope) {
    if (!scope || !scope.path) return 'Everywhere you have access';
    if (scope.type === 'group') {
      return 'Group ' + scope.path + (scope.includeSubgroups ? ' and its subgroups' : ' (not its subgroups)');
    }
    return 'Project ' + scope.path;
  }

  function renderContext() {
    var context = state.context;
    var settings = state.settings;
    if (!context || !settings) return;
    text(el('chat-scope'), describeScope(context.scope));
    var values = settings.values || {};
    text(el('default-scope'), values.scope
      ? values.scope + (values.scopeIncludeSubgroups ? '' : ' (not its subgroups)')
      : 'Everywhere you have access');
    text(el('access-preset'), context.presetName || 'None');
    text(el('access-readonly'), context.readOnly ? 'On: tools that change GitLab are off' : 'Off');
    // What this chat has off: the account's choices and its preset's.
    var off = (context.disabledToolGroups || []).map(function (group) {
      return (settings.schema.properties['tools_' + group] || {}).title || group;
    });
    text(el('access-groups'), off.length ? off.join(', ') : 'All offered groups are on');
  }

  function renderHealth(check) {
    var status = el('health-status');
    if (!check) return;
    if (check.authenticated) {
      status.className = 'status-ok';
      text(status, 'Connected');
    } else {
      status.className = 'status-error';
      text(status, 'GitLab did not accept the current sign-in');
    }
    text(el('health-account'), check.account);
    text(el('health-instance'), check.instance);
    text(el('health-gitlab'), check.gitlabVersion + ' (' + check.tier + ')');
    text(el('health-tools'), check.availableTools);
    var advice = el('health-advice');
    clear(advice);
    (check.warnings || []).concat(check.recommendations || []).forEach(function (line) {
      var item = document.createElement('li');
      text(item, line);
      advice.appendChild(item);
    });
    el('health-advice-block').hidden = advice.childNodes.length === 0;
  }

  function renderResults() {
    var list = el('results');
    clear(list);
    if (state.query.length >= 2 && state.results.length === 0 && !state.busy) {
      var empty = document.createElement('li');
      empty.setAttribute('role', 'option');
      empty.setAttribute('aria-disabled', 'true');
      text(empty, 'No project or group matches “' + state.query + '”');
      list.appendChild(empty);
      return;
    }
    state.results.forEach(function (target, index) {
      var item = document.createElement('li');
      item.id = 'result-' + index;
      item.setAttribute('role', 'option');
      item.tabIndex = 0;
      var selected = state.selected && state.selected.path === target.path && state.selected.type === target.type;
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      var name = document.createElement('span');
      text(name, target.name);
      var kind = document.createElement('span');
      kind.className = 'kind';
      text(kind, target.type + ' · ' + target.path);
      item.appendChild(name);
      item.appendChild(kind);
      item.addEventListener('click', function () { select(target); });
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(target); }
        if (event.key === 'ArrowDown' && item.nextSibling) item.nextSibling.focus();
        if (event.key === 'ArrowUp' && item.previousSibling) item.previousSibling.focus();
      });
      list.appendChild(item);
    });
  }

  function renderSelection() {
    var target = state.selected;
    var subgroups = el('subgroups');
    el('subgroups-row').hidden = !target || target.type !== 'group';
    text(el('preview'), target
      ? 'Selected: ' + describeScope({ type: target.type, path: target.path, includeSubgroups: subgroups.checked })
      : 'Choose a project or group to work in.');
    el('use-chat').disabled = !target || state.busy;
    el('save-default').disabled = !target || state.busy;
    el('cancel').disabled = !target || state.busy;
  }

  function select(target) {
    state.selected = target;
    renderResults();
    renderSelection();
  }

  function setBusy(busy) {
    state.busy = busy;
    ['use-chat', 'save-default', 'work-everywhere', 'check-again'].forEach(function (id) {
      el(id).disabled = busy;
    });
    renderSelection();
    document.body.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  // ---- Data: always the server's authoritative state ----
  function reload() {
    return Promise.all([
      callTool('get_settings', {}),
      callTool('manage_context', { action: 'show' }),
    ]).then(function (results) {
      state.settings = results[0];
      state.context = results[1].data || results[1];
      renderContext();
    });
  }

  function checkHealth() {
    text(el('health-status'), 'Checking…');
    el('health-status').className = 'muted';
    return callTool('check_connection', {}).then(renderHealth).catch(function (error) {
      el('health-status').className = 'status-error';
      text(el('health-status'), explain(error));
    });
  }

  var searchTimer = null;
  function search(query) {
    state.query = query.trim();
    clearTimeout(searchTimer);
    if (state.query.length < 2) { state.results = []; renderResults(); return; }
    searchTimer = setTimeout(function () {
      var asked = state.query;
      state.busy = true;
      callTool('find_scope_targets', { query: asked }).then(function (found) {
        if (asked !== state.query) return;
        state.results = found.targets || [];
      }).catch(function (error) {
        state.results = [];
        announce(explain(error), 'error');
      }).then(function () {
        state.busy = false;
        renderResults();
        renderSelection();
      });
    }, 300);
  }

  function save(where) {
    var target = state.selected;
    if (!target) return;
    var includeSubgroups = target.type === 'group' && el('subgroups').checked;
    setBusy(true);
    announce('Saving…');
    var action = where === 'chat'
      ? callTool('manage_context', { action: 'set_scope', namespace: target.path, includeSubgroups: includeSubgroups })
      : callTool('update_settings', { set: { scope: target.path, scopeIncludeSubgroups: includeSubgroups } });
    action.then(reload).then(function () {
      // Success is reported from what the server now holds, not from the request.
      var applied = where === 'chat'
        ? state.context.scope && state.context.scope.path === target.path
        : state.settings.values.scope === target.path;
      if (applied) {
        announce(where === 'chat'
          ? 'This chat now works in ' + describeScope(state.context.scope) + '.'
          : 'New chats will work in ' + target.path + '.', 'ok');
        state.selected = null;
        renderResults();
      } else {
        announce('The server did not keep this change. Check the settings and try again.', 'error');
      }
    }).catch(function (error) {
      announce(explain(error), 'error');
    }).then(function () { setBusy(false); });
  }

  function workEverywhere() {
    setBusy(true);
    announce('Saving…');
    // Only this chat's scope changes; its preset, read-only mode and the default for new
    // chats stay as they are.
    callTool('manage_context', { action: 'clear_scope' })
      .then(reload)
      .then(function () {
        announce(state.context.scope ? 'A preset still limits where this chat works.' : 'This chat works everywhere you have access.',
          state.context.scope ? 'warning' : 'ok');
      })
      .catch(function (error) { announce(explain(error), 'error'); })
      .then(function () { setBusy(false); });
  }

  function start() {
    el('search').addEventListener('input', function (event) { search(event.target.value); });
    el('subgroups').addEventListener('change', renderSelection);
    el('use-chat').addEventListener('click', function () { save('chat'); });
    el('save-default').addEventListener('click', function () { save('default'); });
    el('cancel').addEventListener('click', function () { state.selected = null; renderResults(); renderSelection(); announce(''); });
    el('work-everywhere').addEventListener('click', workEverywhere);
    el('check-again').addEventListener('click', checkHealth);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !state.busy) reload().catch(function () {});
    });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () {
        notify('ui/notifications/size-changed', { height: document.documentElement.scrollHeight });
      }).observe(document.body);
    }
    renderSelection();

    request('ui/initialize', {
      appInfo: { name: 'gitlab-mcp-settings', version: VERSION },
      appCapabilities: {},
      protocolVersion: PROTOCOL,
    }).then(function (result) {
      applyHostContext(result && result.hostContext);
      notify('ui/notifications/initialized');
      if (!result || !result.hostCapabilities || !result.hostCapabilities.serverTools) {
        el('main').hidden = true;
        announce('This app cannot reach the GitLab server from here. Use the GitLab settings page, or ask the assistant to change the settings.', 'error');
        return;
      }
      el('loading').hidden = true;
      el('main').hidden = false;
      return Promise.all([reload(), checkHealth()]);
    }).catch(function (error) {
      el('loading').hidden = true;
      announce(explain(error), 'error');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
`;

const BODY = `
<header>
  <h1>GitLab connection</h1>
  <p class="muted">Choose where this chat works and check what the connection can do.</p>
</header>
<p id="loading" class="muted" role="status">Loading…</p>
<div id="main" hidden>
  <section aria-labelledby="where-title">
    <h2 id="where-title">Where to work</h2>
    <dl>
      <dt>This chat</dt><dd id="chat-scope"></dd>
      <dt>New chats</dt><dd id="default-scope"></dd>
    </dl>
    <div style="margin-top:12px">
      <label for="search">Find a project or group</label>
      <input id="search" type="search" autocomplete="off" spellcheck="false"
        placeholder="At least 2 characters" aria-controls="results" />
      <ul id="results" class="results" role="listbox" aria-label="Projects and groups"></ul>
    </div>
    <p id="preview" class="muted"></p>
    <div id="subgroups-row" class="row" hidden>
      <input id="subgroups" type="checkbox" checked />
      <label for="subgroups" style="display:inline;font-weight:normal">Include projects in subgroups</label>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="use-chat" class="primary" type="button">Use in this chat</button>
      <button id="save-default" type="button">Save for new chats</button>
      <button id="cancel" type="button">Cancel</button>
      <button id="work-everywhere" type="button">Work everywhere in this chat</button>
    </div>
  </section>
  <section aria-labelledby="access-title">
    <h2 id="access-title">What this chat can do</h2>
    <dl>
      <dt>Preset</dt><dd id="access-preset"></dd>
      <dt>Read-only</dt><dd id="access-readonly"></dd>
      <dt>Tool groups off</dt><dd id="access-groups"></dd>
    </dl>
    <p class="muted">Presets, read-only mode and tool groups are changed on the GitLab settings page.</p>
  </section>
  <section aria-labelledby="health-title">
    <h2 id="health-title">Connection</h2>
    <p id="health-status" class="muted" role="status"></p>
    <dl>
      <dt>Account</dt><dd id="health-account"></dd>
      <dt>GitLab</dt><dd id="health-instance"></dd>
      <dt>Version</dt><dd id="health-gitlab"></dd>
      <dt>Tools available</dt><dd id="health-tools"></dd>
    </dl>
    <div id="health-advice-block" hidden>
      <h2 style="margin-top:8px">What to check</h2>
      <ul id="health-advice" class="plain"></ul>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="check-again" type="button">Check again</button>
    </div>
  </section>
</div>
<div id="notice" role="status" aria-live="polite"></div>
`;

/** The panel document. */
export function settingsPanelHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>GitLab connection</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    BODY,
    `<script>${SCRIPT}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}
