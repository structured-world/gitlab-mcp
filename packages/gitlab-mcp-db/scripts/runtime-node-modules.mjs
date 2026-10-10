#!/usr/bin/env node
/**
 * Copy what the PostgreSQL backend and `prisma migrate` load into a standalone
 * node_modules directory for the Docker image.
 *
 * Starting from the entry points, every package reachable through `dependencies` /
 * `optionalDependencies` is copied with its path relative to the source node_modules, so
 * nested versions keep resolving exactly as they do in the build. Prisma Studio, `prisma
 * dev` and the MySQL driver are cut down or left out, and the query compilers of other
 * databases, Studio assets, source maps and TypeScript files are removed afterwards.
 *
 * Usage: node runtime-node-modules.mjs <target node_modules directory>
 */

import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) {
  console.error('Usage: node runtime-node-modules.mjs <target node_modules directory>');
  process.exit(1);
}

/**
 * Modules the backend imports at runtime (dist/src/postgresql.js and the generated client),
 * plus the Prisma CLI and the config loader `prisma migrate deploy` needs.
 */
const ENTRY_POINTS = ['@prisma/client/runtime/client', '@prisma/adapter-pg', 'prisma', 'dotenv'];

/**
 * CLI dependencies `prisma migrate deploy` never loads (the MySQL driver), or loads only a
 * few self-contained files of at startup: Studio's data layer without its UI stack, and the
 * state module of `prisma dev` (a local embedded Postgres) without the server. Only the
 * listed files are copied, and only the listed dependencies (what those files require) are
 * followed. A Prisma upgrade that loads more fails the image's migration smoke check.
 */
const SKIPPED_PACKAGES = new Set(['mysql2']);
const PARTIAL_PACKAGES = new Map([
  [
    '@prisma/studio-core',
    {
      files: [
        'dist/data/bff/index.cjs',
        'dist/data/mysql2/index.cjs',
        'dist/data/node-sqlite/index.cjs',
        'dist/data/postgresjs/index.cjs',
      ],
      dependencies: [],
    },
  ],
  [
    '@prisma/dev',
    {
      files: ['dist/state.cjs'],
      dependencies: [
        'get-port-please',
        'pathe',
        'proper-lockfile',
        'remeda',
        'std-env',
        'valibot',
        'zeptomatch',
      ],
    },
  ],
]);

/**
 * Directory of package `name` as Node finds it from directory `from`: the nearest
 * `node_modules/<name>` walking up. Independent of `exports`, so ESM-only packages and
 * packages that hide package.json resolve too. Undefined when not installed.
 */
function resolvePackage(name, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dir === dirname(dir)) return undefined;
    dir = dirname(dir);
  }
}

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

const seen = new Set();
const queue = ENTRY_POINTS.map((entry) => {
  const root = resolvePackage(packageName(entry), packageDir);
  if (!root) throw new Error(`Runtime entry ${entry} is not installed`);
  return root;
});

while (queue.length > 0) {
  const root = queue.pop();
  if (seen.has(root)) continue;
  seen.add(root);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const partial = PARTIAL_PACKAGES.get(manifest.name);
  const optional = Object.keys(manifest.optionalDependencies ?? {});
  const dependencies = partial
    ? partial.dependencies
    : [...Object.keys(manifest.dependencies ?? {}), ...optional];
  for (const dependency of dependencies) {
    // Type declarations are not loaded at runtime.
    if (dependency.startsWith('@types/') || SKIPPED_PACKAGES.has(dependency)) continue;
    const dependencyRoot = resolvePackage(dependency, root);
    if (dependencyRoot) {
      queue.push(dependencyRoot);
    } else if (!optional.includes(dependency)) {
      throw new Error(`${manifest.name} depends on ${dependency}, which is not installed`);
    }
  }
}

// Package root copied to each target path. A workspace-local copy (a conflicting version
// the linker kept under the package) and the hoisted copy would map to the same path; the
// copy would merge two versions' files, so that layout fails the build instead.
const destinations = new Map();
for (const root of seen) {
  // Keep the layout below the outermost node_modules so nested versions stay nested.
  const marker = `${sep}node_modules${sep}`;
  if (!root.includes(marker)) throw new Error(`${root} is not inside a node_modules directory`);
  const relativePath = root.slice(root.indexOf(marker) + marker.length);
  const previous = destinations.get(relativePath);
  if (previous !== undefined && previous !== root) {
    throw new Error(`${previous} and ${root} would both be copied to ${relativePath}`);
  }
  destinations.set(relativePath, root);
  const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
  const partial = PARTIAL_PACKAGES.get(name);
  if (partial) {
    for (const file of ['package.json', ...partial.files]) {
      if (!existsSync(join(root, file))) throw new Error(`${name} no longer ships ${file}`);
      cpSync(join(root, file), join(target, relativePath, file));
    }
    continue;
  }
  cpSync(root, join(target, relativePath), {
    recursive: true,
    dereference: true,
    // A package's own nested node_modules is copied separately, only where reachable.
    filter: (source) => !relative(root, source).split(sep).includes('node_modules'),
  });
}

// The generated client and the CLI load only the "fast" PostgreSQL query compiler.
for (const dir of [join(target, '@prisma', 'client', 'runtime'), join(target, 'prisma', 'build')]) {
  for (const file of readdirSync(dir)) {
    if (
      file.startsWith('query_compiler_') &&
      !file.startsWith('query_compiler_fast_bg.postgresql.')
    ) {
      rmSync(join(dir, file));
    }
  }
}

// Studio's UI assets, and the wasm schema engine: migrations run on the native schema
// engine that @prisma/engines installs for the build platform.
for (const file of ['studio.js', 'studio.css', 'schema_engine_bg.wasm']) {
  rmSync(join(target, 'prisma', 'build', file));
}

// Source maps, TypeScript sources and declarations are never loaded at runtime.
const NON_RUNTIME_FILE = /(\.map|\.[cm]?ts)$/;
function removeNonRuntimeFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) removeNonRuntimeFiles(path);
    else if (NON_RUNTIME_FILE.test(entry)) rmSync(path);
  }
}
removeNonRuntimeFiles(target);

console.log(`Copied ${seen.size} runtime packages to ${target}`);
