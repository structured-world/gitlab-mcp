/**
 * The settings panel, run in a DOM against a simulated MCP Apps host. The host answers
 * ui/initialize and proxies tools/call to fake tools, as a real host proxies them to the
 * server. The panel must show GitLab strings as text only, report success only from the
 * state the server returns, and say what to do when sign-in expired or GitLab is down.
 */

import { JSDOM } from 'jsdom';
import { settingsPanelHtml } from '../../../../src/entities/context/settings-panel';

type ToolHandler = (args: Record<string, unknown>) => unknown;

interface PanelOptions {
  tools?: Record<string, ToolHandler>;
  hostCapabilities?: Record<string, unknown>;
  hostContext?: Record<string, unknown>;
}

interface Message {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

const SETTINGS = {
  schema: {
    type: 'object',
    properties: {
      preset: { type: 'string', title: 'Working preset' },
      tools_wiki: { type: 'boolean', title: 'Wiki' },
    },
  },
  values: { preset: 'none', scope: '', scopeIncludeSubgroups: true, tools_wiki: true },
  layout: [],
};

const HEALTH = {
  account: 'alice',
  instance: 'https://gitlab.example.com',
  gitlabVersion: '17.4.0',
  tier: 'premium',
  authenticated: true,
  readOnly: false,
  preset: null,
  scope: null,
  availableTools: 42,
  warnings: [],
  recommendations: [],
};

function defaultTools(): Record<string, ToolHandler> {
  let scope: unknown;
  return {
    get_settings: () => SETTINGS,
    manage_context: (args) => {
      if (args.action === 'set_scope') {
        scope = {
          type: 'group',
          path: args.namespace,
          includeSubgroups: args.includeSubgroups,
          detected: true,
        };
        return { action: 'set_scope', data: { success: true } };
      }
      if (args.action === 'clear_scope') {
        scope = undefined;
        return { action: 'clear_scope', data: { success: true } };
      }
      return { action: 'show', data: { readOnly: false, presetName: undefined, scope } };
    },
    check_connection: () => HEALTH,
    find_scope_targets: () => ({
      targets: [
        { type: 'group', path: 'team', name: 'Team' },
        { type: 'project', path: 'team/app', name: 'Team / App' },
      ],
    }),
    update_settings: (args) => ({ values: { ...SETTINGS.values, ...(args.set as object) } }),
  };
}

/** Closed after each test, which also stops the panel's pending request timers. */
const openWindows: JSDOM[] = [];

afterEach(() => {
  for (const dom of openWindows.splice(0)) dom.window.close();
});

/** Run the panel with a simulated host; returns the DOM and what the host received. */
function startPanel(options: PanelOptions = {}) {
  const tools = { ...defaultTools(), ...options.tools };
  const received: Message[] = [];
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let panelWindow: JSDOM['window'];

  // Requests the host still owes an answer to; the panel is idle when there are none.
  let unanswered = 0;

  const reply = (message: Message) => {
    setTimeout(() => {
      panelWindow.dispatchEvent(
        new panelWindow.MessageEvent('message', { data: message, source: host as never }),
      );
      if (message.method === undefined) unanswered -= 1;
    }, 0);
  };

  const host = {
    postMessage(message: Message) {
      received.push(message);
      if (message.id !== undefined && message.method !== undefined) unanswered += 1;
      if (message.method === 'ui/initialize' && message.id !== undefined) {
        reply({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'test-host', version: '1' },
            hostCapabilities: options.hostCapabilities ?? { serverTools: {} },
            hostContext: options.hostContext ?? {},
          },
        });
      }
      if (message.method === 'tools/call' && message.id !== undefined) {
        const params = message.params as { name: string; arguments: Record<string, unknown> };
        toolCalls.push(params);
        let result: unknown;
        try {
          const structuredContent = tools[params.name](params.arguments);
          result = {
            content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
            structuredContent,
          };
        } catch (error) {
          result = { isError: true, content: [{ type: 'text', text: (error as Error).message }] };
        }
        reply({ jsonrpc: '2.0', id: message.id, result });
      }
    },
  };

  const dom = new JSDOM(settingsPanelHtml(), {
    runScripts: 'dangerously',
    beforeParse(window) {
      panelWindow = window;
      Object.defineProperty(window, 'parent', { value: host, configurable: true });
    },
  });
  openWindows.push(dom);
  const document = dom.window.document;
  return {
    dom,
    document,
    received,
    toolCalls,
    host,
    byId: (id: string) => document.getElementById(id) as HTMLElement,
    hostSends: reply,
    /** Resolves once the panel started and every request it made has been answered. */
    idle: () => waitFor(() => received.length > 0 && unanswered === 0),
  };
}

/** Polls instead of sleeping a fixed time, so a loaded machine cannot make it flaky. */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let held = 0;
  while (held < 2) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the panel');
    await new Promise((resolve) => setTimeout(resolve, 5));
    held = condition() ? held + 1 : 0;
  }
}

async function typeSearch(panel: ReturnType<typeof startPanel>, value: string): Promise<void> {
  const searches = () => panel.toolCalls.filter((c) => c.name === 'find_scope_targets').length;
  const before = searches();
  const input = panel.byId('search') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new panel.dom.window.Event('input'));
  if (value.trim().length >= 2) await waitFor(() => searches() > before);
  await panel.idle();
}

describe('settings panel', () => {
  it('initializes with the host before calling any tool and shows the server state', async () => {
    const panel = startPanel();
    await panel.idle();

    expect(panel.received[0]).toMatchObject({
      method: 'ui/initialize',
      params: {
        protocolVersion: '2026-01-26',
        appInfo: { name: 'gitlab-mcp-settings' },
        appCapabilities: {},
      },
    });
    const initializedAt = panel.received.findIndex(
      (m) => m.method === 'ui/notifications/initialized',
    );
    const firstCallAt = panel.received.findIndex((m) => m.method === 'tools/call');
    expect(initializedAt).toBeGreaterThan(0);
    expect(firstCallAt).toBeGreaterThan(initializedAt);
    expect(panel.byId('main').hidden).toBe(false);
    expect(panel.byId('chat-scope').textContent).toBe('Everywhere you have access');
    expect(panel.byId('health-status').textContent).toBe('Connected');
    expect(panel.byId('health-tools').textContent).toBe('42');
  });

  // A preset can turn groups off that the account left on: the preview shows what this
  // chat actually has, not only the account's own choices.
  it('shows the tool groups that are off in this chat, also by its preset', async () => {
    const panel = startPanel({
      tools: {
        manage_context: () => ({
          action: 'show',
          data: { readOnly: false, presetName: 'ci', disabledToolGroups: ['wiki', 'runners'] },
        }),
      },
    });
    await panel.idle();

    expect(panel.byId('access-groups').textContent).toBe('Wiki, runners');
  });

  it('says all groups are on when this chat has none off', async () => {
    const panel = startPanel();
    await panel.idle();

    expect(panel.byId('access-groups').textContent).toBe('All offered groups are on');
  });

  it('applies the host theme and style variables', async () => {
    const panel = startPanel({
      hostContext: {
        theme: 'dark',
        styles: { variables: { '--color-text-primary': 'rgb(1, 2, 3)', notAVariable: 'x' } },
      },
    });
    await panel.idle();

    const root = panel.document.documentElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--color-text-primary')).toBe('rgb(1, 2, 3)');
    expect(root.style.getPropertyValue('notAVariable')).toBe('');
  });

  it('follows a theme change of the host', async () => {
    const panel = startPanel({ hostContext: { theme: 'dark' } });
    await panel.idle();

    panel.hostSends({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { theme: 'light' },
    });
    await panel.idle();

    expect(panel.document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('explains instead of failing when the host cannot call server tools', async () => {
    const panel = startPanel({ hostCapabilities: {} });
    await panel.idle();

    expect(panel.toolCalls).toHaveLength(0);
    expect(panel.byId('main').hidden).toBe(true);
    expect(panel.byId('notice').textContent).toContain('cannot reach the GitLab server');
  });

  it('ignores messages that do not come from its host', async () => {
    const panel = startPanel();
    await panel.idle();

    panel.dom.window.dispatchEvent(
      new panel.dom.window.MessageEvent('message', {
        data: {
          jsonrpc: '2.0',
          method: 'ui/notifications/host-context-changed',
          params: { theme: 'light' },
        },
        source: panel.dom.window as never,
      }),
    );
    await panel.idle();

    expect(panel.document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  // GitLab names and server messages are untrusted: they must never become markup.
  it('shows malicious names and messages as text only', async () => {
    const markup = '<img src=x onerror="window.__pwned=1">';
    const panel = startPanel({
      tools: {
        find_scope_targets: () => ({ targets: [{ type: 'group', path: 'evil', name: markup }] }),
        check_connection: () => ({ ...HEALTH, account: markup, warnings: [markup] }),
      },
    });
    await panel.idle();
    await typeSearch(panel, 'ev');

    expect(panel.document.querySelector('img')).toBeNull();
    expect(panel.byId('results').textContent).toContain(markup);
    expect(panel.byId('health-account').textContent).toBe(markup);
    expect((panel.dom.window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('searches only from two characters on, after typing pauses', async () => {
    const panel = startPanel();
    await panel.idle();

    await typeSearch(panel, 't');
    expect(panel.toolCalls.filter((c) => c.name === 'find_scope_targets')).toHaveLength(0);

    await typeSearch(panel, 'te');
    expect(panel.toolCalls.filter((c) => c.name === 'find_scope_targets')).toEqual([
      { name: 'find_scope_targets', arguments: { query: 'te' } },
    ]);
    const options = panel.byId('results').querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
  });

  it('says so when nothing matches', async () => {
    const panel = startPanel({ tools: { find_scope_targets: () => ({ targets: [] }) } });
    await panel.idle();

    await typeSearch(panel, 'zz');

    expect(panel.byId('results').textContent).toContain('No project or group matches');
  });

  it('selects a result with the keyboard and offers subgroups for a group', async () => {
    const panel = startPanel();
    await panel.idle();
    await typeSearch(panel, 'te');

    const first = panel.byId('result-0');
    first.dispatchEvent(new panel.dom.window.KeyboardEvent('keydown', { key: 'Enter' }));

    expect(panel.byId('result-0').getAttribute('aria-selected')).toBe('true');
    expect(panel.byId('subgroups-row').hidden).toBe(false);
    expect((panel.byId('use-chat') as HTMLButtonElement).disabled).toBe(false);
    expect(panel.byId('preview').textContent).toBe('Selected: Group team and its subgroups');
  });

  it('applies a scope to this chat and confirms it from the server state', async () => {
    const panel = startPanel();
    await panel.idle();
    await typeSearch(panel, 'te');
    panel.byId('result-0').click();

    panel.byId('use-chat').click();
    await panel.idle();

    expect(panel.toolCalls).toContainEqual({
      name: 'manage_context',
      arguments: { action: 'set_scope', namespace: 'team', includeSubgroups: true },
    });
    expect(panel.byId('notice').textContent).toBe(
      'This chat now works in Group team and its subgroups.',
    );
    expect(panel.byId('chat-scope').textContent).toBe('Group team and its subgroups');
  });

  // The request "succeeded" but the server holds something else: no false success.
  it('reports a change the server did not keep', async () => {
    const tools = defaultTools();
    const panel = startPanel({
      tools: {
        manage_context: (args) =>
          args.action === 'set_scope'
            ? { action: 'set_scope', data: { success: true } }
            : tools.manage_context({ action: 'show' }),
      },
    });
    await panel.idle();
    await typeSearch(panel, 'te');
    panel.byId('result-0').click();

    panel.byId('use-chat').click();
    await panel.idle();

    expect(panel.byId('notice').textContent).toBe(
      'The server did not keep this change. Check the settings and try again.',
    );
  });

  it('saves the default for new chats as a settings patch', async () => {
    let saved: Record<string, unknown> | undefined;
    const panel = startPanel({
      tools: {
        update_settings: (args) => {
          saved = args.set as Record<string, unknown>;
          return { values: { ...SETTINGS.values, ...saved } };
        },
        get_settings: () =>
          saved ? { ...SETTINGS, values: { ...SETTINGS.values, ...saved } } : SETTINGS,
      },
    });
    await panel.idle();
    await typeSearch(panel, 'te');
    panel.byId('result-1').click();

    panel.byId('save-default').click();
    await panel.idle();

    expect(saved).toEqual({ scope: 'team/app', scopeIncludeSubgroups: false });
    expect(panel.byId('notice').textContent).toBe('New chats will work in team/app.');
  });

  // Working everywhere changes this chat's scope only: no reset of its preset or read-only
  // mode, and no change of the default for new chats.
  it('clears only the scope of this chat when working everywhere', async () => {
    const panel = startPanel();
    await panel.idle();

    panel.byId('work-everywhere').click();
    await panel.idle();

    const writes = panel.toolCalls.filter(
      (c) =>
        c.name === 'update_settings' ||
        (c.name === 'manage_context' && c.arguments.action !== 'show'),
    );
    expect(writes).toEqual([{ name: 'manage_context', arguments: { action: 'clear_scope' } }]);
    expect(panel.byId('notice').textContent).toBe('This chat works everywhere you have access.');
  });

  it('cancels a selection without saving', async () => {
    const panel = startPanel();
    await panel.idle();
    await typeSearch(panel, 'te');
    panel.byId('result-0').click();

    panel.byId('cancel').click();

    expect(panel.byId('preview').textContent).toBe('Choose a project or group to work in.');
    expect(panel.toolCalls.some((c) => c.name === 'update_settings')).toBe(false);
  });

  it('tells the user to reconnect when the sign-in expired', async () => {
    const panel = startPanel({
      tools: {
        manage_context: () => {
          throw new Error('invalid_token: GitLab token refresh failed. Please re-authenticate.');
        },
      },
    });
    await panel.idle();

    expect(panel.byId('notice').textContent).toBe(
      'Your GitLab sign-in expired or was revoked. Reconnect GitLab from the app’s connection settings, then open this panel again.',
    );
  });

  it('says GitLab is unreachable and recovers with Check again', async () => {
    let down = true;
    const panel = startPanel({
      tools: {
        check_connection: () => {
          if (down) throw new Error('CONNECTION_FAILED: instance unreachable');
          return HEALTH;
        },
      },
    });
    await panel.idle();
    expect(panel.byId('health-status').textContent).toBe(
      'GitLab is not reachable right now. Your saved settings still apply; try again in a moment.',
    );

    down = false;
    panel.byId('check-again').click();
    await panel.idle();

    expect(panel.byId('health-status').textContent).toBe('Connected');
  });

  it('lists warnings and recommendations as what to check', async () => {
    const panel = startPanel({
      tools: {
        check_connection: () => ({
          ...HEALTH,
          authenticated: false,
          warnings: ['Token expires today!'],
          recommendations: ['Create a new token'],
        }),
      },
    });
    await panel.idle();

    expect(panel.byId('health-status').textContent).toBe(
      'GitLab did not accept the current sign-in',
    );
    expect(panel.byId('health-advice-block').hidden).toBe(false);
    expect(
      [...panel.byId('health-advice').querySelectorAll('li')].map((li) => li.textContent),
    ).toEqual(['Token expires today!', 'Create a new token']);
  });

  it('answers a teardown request from the host', async () => {
    const panel = startPanel();
    await panel.idle();

    panel.hostSends({ jsonrpc: '2.0', id: 99, method: 'ui/resource-teardown', params: {} });
    await panel.idle();

    expect(panel.received).toContainEqual({ jsonrpc: '2.0', id: 99, result: {} });
  });

  it('reports its size to the host when it changes', async () => {
    let observed: (() => void) | undefined;
    const received: Message[] = [];
    const dom = new JSDOM(settingsPanelHtml(), {
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window, 'parent', {
          value: { postMessage: (m: Message) => received.push(m) },
          configurable: true,
        });
        (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
          constructor(callback: () => void) {
            observed = callback;
          }
          observe() {}
        };
      },
    });
    openWindows.push(dom);
    expect(dom.window.document.title).toBe('GitLab connection');
    await waitFor(() => observed !== undefined);

    observed?.();

    expect(received).toContainEqual({
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: { height: expect.any(Number) },
    });
  });

  it('labels its controls for assistive technology', () => {
    const { document } = startPanel();

    expect(document.querySelector('label[for="search"]')?.textContent).toBe(
      'Find a project or group',
    );
    expect(document.getElementById('results')?.getAttribute('role')).toBe('listbox');
    expect(document.getElementById('notice')?.getAttribute('aria-live')).toBe('polite');
    for (const button of document.querySelectorAll('button')) {
      expect(button.getAttribute('type')).toBe('button');
      expect(button.textContent?.trim()).not.toBe('');
    }
  });
});
