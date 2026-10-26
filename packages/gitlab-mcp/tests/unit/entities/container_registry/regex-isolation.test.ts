import { Worker } from 'node:worker_threads';

// A separate watchdog can terminate the test even when the handler blocks its own event loop.
it('bounds catastrophic cleanup matching and keeps another request responsive', async () => {
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    require(workerData.register).register({
      transpileOnly: true,
      project: workerData.config,
      compilerOptions: { rootDir: require('node:path').dirname(workerData.config) }
    });
    const Module = require('node:module');
    const original = Module._load;
    const client = { request: async (document) => {
      if (document.definitions[0].name.value === 'ListContainerRepositoryTags') {
        return { containerRepository: { tags: {
          nodes: [{ name: 'a'.repeat(40) + '!', createdAt: null }],
          pageInfo: { hasNextPage: false, endCursor: null }
        } } };
      }
      throw new Error('No mutation is permitted');
    } };
    Module._load = function(name, ...args) {
      if (name.endsWith('/services/ConnectionManager')) {
        return { ConnectionManager: { getInstance: () => ({ getClient: () => client }) } };
      }
      return original.call(this, name, ...args);
    };
    const { containerRegistryToolRegistry: registry } = require(workerData.registry);
    setTimeout(async () => {
      const result = await registry.get('browse_registry').handler({
        action: 'get_repository', repository_id: 1
      }).catch(() => 'responsive');
      parentPort.postMessage({ responsive: result === 'responsive' });
    }, 100);
    registry.get('manage_registry').handler({
      action: 'delete_tags_bulk', repository_id: 1, name_regex_delete: '(a+)+$'
    }).then(() => parentPort.postMessage({ unexpectedSuccess: true }),
      error => parentPort.postMessage({ error: error.message }));
    `,
    {
      eval: true,
      workerData: {
        register: require.resolve('ts-node'),
        config: require.resolve('../../../../tsconfig.json'),
        registry: require.resolve('../../../../src/entities/container_registry/registry'),
      },
    },
  );
  try {
    const messages: { responsive?: boolean; error?: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Cleanup blocked the server for 5 seconds')),
        5000,
      );
      worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.on('message', (message) => {
        messages.push(message);
        if (messages.length === 2) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(messages[0]).toEqual({ responsive: true });
    expect(messages[1]).toEqual({ error: expect.stringMatching(/time limit/) });
  } finally {
    await worker.terminate();
  }
}, 10000);
