import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { compareCodeUnits } from './zip';

interface RuntimePackage {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

/** Include installed production dependencies only, preserving conflicting versions at their consumer. */
export function collectRuntime(root: string, files: Map<string, Buffer>): void {
  const metadata = (dir: string): RuntimePackage =>
    JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as RuntimePackage;
  const occupied = new Map<string, string>();
  const dependencyDirectory = (
    requireFrom: ReturnType<typeof createRequire>,
    name: string,
  ): string => {
    // Package exports need not provide a root entry point (the MCP SDK does not).
    const lookup = requireFrom.resolve.paths(name) ?? [];
    const packageJson = lookup.map((dir) => join(dir, name, 'package.json')).find(existsSync);
    if (!packageJson) throw new Error(`Cannot find runtime dependency ${name}`);
    let dependency = dirname(packageJson);
    while (!existsSync(join(dependency, 'package.json')) || metadata(dependency).name !== name) {
      const next = dirname(dependency);
      if (next === dependency) throw new Error(`Cannot find runtime dependency ${name}`);
      dependency = next;
    }
    return realpathSync(dependency);
  };
  const copy = (source: string, target: string): void => {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const legal = /^(?:licen[sc]e|notice|copying)(?:[.-]|$)/i.test(entry.name);
      if (
        ['node_modules', '.git', 'test', 'tests', 'coverage', 'docs'].includes(entry.name) ||
        (!legal && /\.(?:map|md|ts|mts|cts)$/i.test(entry.name))
      )
        continue;
      const from = join(source, entry.name);
      const to = posix.join(target, entry.name);
      if (entry.isDirectory()) copy(from, to);
      else if (entry.isFile()) files.set(to, readFileSync(from));
      else throw new Error(`Runtime package contains an unsupported symbolic link: ${entry.name}`);
    }
  };
  const dependencies = (source: string, parent: string): void => {
    const requireFrom = createRequire(join(source, 'package.json'));
    for (const name of Object.keys(metadata(source).dependencies ?? {}).sort(compareCodeUnits)) {
      const dependency = dependencyDirectory(requireFrom, name);
      let ancestor = parent;
      let installed: string | undefined;
      for (;;) {
        installed = occupied.get(posix.join(ancestor, 'node_modules', name));
        if (installed || ancestor === 'runtime') break;
        ancestor = posix.dirname(ancestor);
      }
      if (installed === dependency) continue;
      const shared = posix.join('runtime/node_modules', name);
      const target = occupied.has(shared) ? posix.join(parent, 'node_modules', name) : shared;
      occupied.set(target, dependency);
      copy(dependency, target);
      dependencies(dependency, target);
    }
  };
  const compiled = join(root, 'dist', 'src');
  if (!existsSync(join(compiled, 'plugin', 'main.js')))
    throw new Error('Build the core package before building the local plugin.');
  copy(compiled, 'runtime/src');
  const version = metadata(root).version;
  files.set(
    'runtime/package.json',
    Buffer.from(
      JSON.stringify({
        name: 'gitlab-mcp-plugin-runtime',
        version,
        private: true,
        type: 'commonjs',
      }),
    ),
  );
  dependencies(root, 'runtime');
  for (const name of ['LICENSE', 'NOTICE']) {
    if (existsSync(join(root, name))) files.set(`runtime/${name}`, readFileSync(join(root, name)));
  }
}
