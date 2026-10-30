import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectRuntime } from '../../../../src/cli/plugin/runtime';

let root: string;
const write = (path: string, value: string) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gitlab-runtime-'));
  write('package.json', JSON.stringify({ name: 'fixture', version: '1.2.3' }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function dependency(
  path: string,
  name: string,
  dependencies: Record<string, string>,
  code: string,
) {
  write(
    `${path}/package.json`,
    JSON.stringify({ name, version: '1.0.0', dependencies, exports: { './value': './index.js' } }),
  );
  write(`${path}/index.js`, code);
}

test('the standalone runtime resolves conflicting dependencies and cyclic package metadata', () => {
  // Execute the exported closure: flattening both shared versions breaks the second consumer.
  write('package.json', JSON.stringify({ version: '1.2.3', dependencies: { a: '*', b: '*' } }));
  write('dist/src/plugin/main.js', "module.exports = [require('a/value'), require('b/value')];");
  dependency('node_modules/a', 'a', { shared: '*' }, "module.exports = require('shared/value');");
  dependency('node_modules/b', 'b', { shared: '*' }, "module.exports = require('shared/value');");
  dependency('node_modules/shared', 'shared', { a: '*' }, "module.exports = 'first';");
  dependency('node_modules/b/node_modules/shared', 'shared', {}, "module.exports = 'second';");
  write('node_modules/a/LICENSE.md', 'dependency license');
  write('node_modules/a/README.md', 'development documentation');
  write('node_modules/a/index.js.map', '{}');
  write('node_modules/a/tests/private.js', 'not runtime code');
  write('dist/src/plugin/main.ts', 'not compiled code');
  write('LICENSE', 'root license');
  write('NOTICE', 'root notice');
  const files = new Map<string, Buffer>();
  collectRuntime(root, files);
  for (const [path, bytes] of files) write(`exported/${path}`, bytes.toString());
  const requireRuntime = createRequire(join(root, 'exported/runtime/package.json'));
  expect(requireRuntime('./src/plugin/main.js')).toEqual(['first', 'second']);
  expect(files.get('runtime/node_modules/a/LICENSE.md')?.toString()).toBe('dependency license');
  expect(files.get('runtime/LICENSE')?.toString()).toBe('root license');
  expect(files.get('runtime/NOTICE')?.toString()).toBe('root notice');
  expect([...files.keys()].some((path) => /README|\.map$|\.ts$|\/tests\//.test(path))).toBe(false);
});

test('a missing compiled connector prevents packaging', () => {
  // Publishing an archive without its entry point must fail before producing a runtime.
  expect(() => collectRuntime(root, new Map())).toThrow('Build the core package');
});

test('a missing production dependency prevents packaging', () => {
  // A partial installation cannot produce a purportedly standalone archive.
  write('dist/src/plugin/main.js', 'module.exports = {};');
  write('package.json', JSON.stringify({ version: '1.2.3', dependencies: { absent: '*' } }));
  expect(() => collectRuntime(root, new Map())).toThrow('Cannot find runtime dependency absent');
});

test('a mismatched installed package is rejected', () => {
  // A directory bearing another package name must not silently satisfy the requested dependency.
  write('dist/src/plugin/main.js', 'module.exports = {};');
  write('package.json', JSON.stringify({ version: '1.2.3', dependencies: { requested: '*' } }));
  dependency('node_modules/requested', 'another-package', {}, 'module.exports = {};');
  expect(() => collectRuntime(root, new Map())).toThrow('Cannot find runtime dependency requested');
});

test('a runtime dependency cannot introduce a filesystem link into the archive', () => {
  // Junctions also work on Windows without symlink privileges; neither kind is an archive file.
  write('dist/src/plugin/main.js', 'module.exports = {};');
  write('package.json', JSON.stringify({ version: '1.2.3', dependencies: { linked: '*' } }));
  dependency('node_modules/linked', 'linked', {}, 'module.exports = {};');
  mkdirSync(join(root, 'target'));
  symlinkSync(join(root, 'target'), join(root, 'node_modules/linked/alias'), 'junction');
  expect(() => collectRuntime(root, new Map())).toThrow('unsupported symbolic link: alias');
});
