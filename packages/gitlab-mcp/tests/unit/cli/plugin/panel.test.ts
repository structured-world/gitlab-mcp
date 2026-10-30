import { JSDOM } from 'jsdom';
import { setImmediate } from 'node:timers';
import { connectionPanel } from '../../../../src/plugin/panel';

it('keeps secrets in the private app call and renders target strings as text', async () => {
  // Setup must work before a backend exists, without turning provider strings into HTML.
  const script = connectionPanel().split('<script>')[1].split('</script>')[0];
  expect(() => new Function(script)).not.toThrow();
  const calls: Array<Record<string, unknown>> = [];
  let ready: () => void = () => {};
  const loaded = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const dom = new JSDOM(connectionPanel(), {
    runScripts: 'dangerously',
    beforeParse(window) {
      window.postMessage = (message: {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      }) => {
        if (message.id === undefined) return;
        if (message.method === 'tools/call') calls.push(message.params ?? {});
        const result =
          message.method === 'ui/initialize'
            ? {
                hostContext: {
                  theme: 'dark',
                  styles: { variables: { '--color-background-primary': '#101018' } },
                },
              }
            : {
                structuredContent: {
                  revision: 0,
                  state: 'unconfigured',
                  url: '<img src=x onerror=alert(1)>',
                  authorizationUrl: null,
                },
              };
        globalThis.queueMicrotask(() => {
          window.dispatchEvent(
            new window.MessageEvent('message', {
              source: window as unknown as Window,
              data: { jsonrpc: '2.0', id: message.id, result },
            }),
          );
          if (message.method === 'tools/call') ready();
        });
      };
    },
  });
  try {
    await loaded;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const document = dom.window.document;
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-background-primary')).toBe(
      '#101018',
    );
    expect(document.querySelector('#status img')).toBeNull();
    expect(document.querySelector('#status')?.textContent).toContain('<img');
    const token = document.querySelector<HTMLInputElement>('#token');
    const url = document.querySelector<HTMLInputElement>('#url');
    if (!token || !url) throw new Error('Missing setup fields');
    expect(token.type).toBe('password');
    token.value = 'synthetic-panel-secret';
    url.value = 'https://gitlab.example';
    document
      .querySelector('#form')
      ?.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls.at(-1)).toMatchObject({
      name: 'gitlab_plugin_connection',
      arguments: {
        action: 'connect',
        revision: 0,
        connection: {
          mode: 'local',
          url: 'https://gitlab.example',
          token: 'synthetic-panel-secret',
        },
      },
    });
    expect(token.value).toBe('');
    expect(document.body.textContent).not.toContain('synthetic-panel-secret');
  } finally {
    dom.window.close();
  }
});
