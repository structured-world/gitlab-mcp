#!/usr/bin/env node
/**
 * Copy the runtime dependency closure of the PostgreSQL backend into a standalone
 * node_modules directory for the Docker image.
 *
 * Starting from the modules the backend loads at runtime, every package reachable through
 * `dependencies` / `optionalDependencies` is copied with its path relative to the source
 * node_modules, so nested versions keep resolving exactly as they do in the build. Build
 * and migration tooling (the Prisma CLI, Studio, schema engines) is never reached from
 * these entry points and therefore not copied. The Prisma query compilers of other
 * databases and source maps are removed afterwards.
 *
 * Usage: node runtime-node-modules.mjs <target node_modules directory>
 */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) {
  console.error('Usage: node runtime-node-modules.mjs <target node_modules directory>');
  process.exit(1);
}

/** Modules the backend imports at runtime (dist/src/postgresql.js and the generated client). */
const ENTRY_POINTS = ['@prisma/client/runtime/client', '@prisma/adapter-pg'];

/** Root directory of the package `name` that contains `resolvedFile`. */
function packageRoot(resolvedFile, name) {
  let dir = dirname(resolvedFile);
  while (dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error(`No package root for ${name} above ${resolvedFile}`);
}

/** Resolve package `name` as seen from directory `from`; undefined when not installed. */
function resolvePackage(name, from) {
  const require = createRequire(join(from, 'noop.js'));
  for (const request of [`${name}/package.json`, name]) {
    try {
      return packageRoot(require.resolve(request), name);
    } catch {
      // Packages whose exports hide package.json resolve through their main entry.
    }
  }
  return undefined;
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
  const optional = Object.keys(manifest.optionalDependencies ?? {});
  for (const dependency of [...Object.keys(manifest.dependencies ?? {}), ...optional]) {
    // Type declarations are not loaded at runtime.
    if (dependency.startsWith('@types/')) continue;
    const dependencyRoot = resolvePackage(dependency, root);
    if (dependencyRoot) {
      queue.push(dependencyRoot);
    } else if (!optional.includes(dependency)) {
      throw new Error(`${manifest.name} depends on ${dependency}, which is not installed`);
    }
  }
}

for (const root of seen) {
  // Keep the layout below the outermost node_modules so nested versions stay nested.
  const marker = `${sep}node_modules${sep}`;
  const relativePath = root.slice(root.indexOf(marker) + marker.length);
  cpSync(root, join(target, relativePath), {
    recursive: true,
    dereference: true,
    // A package's own nested node_modules is copied separately, only where reachable.
    filter: (source) => !relative(root, source).split(sep).includes('node_modules'),
  });
}

// The generated client loads only the PostgreSQL query compiler.
const runtimeDir = join(target, '@prisma', 'client', 'runtime');
for (const file of readdirSync(runtimeDir)) {
  if (file.startsWith('query_compiler_') && !file.includes('.postgresql.')) {
    rmSync(join(runtimeDir, file));
  }
}

function removeSourceMaps(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) removeSourceMaps(path);
    else if (entry.endsWith('.map')) rmSync(path);
  }
}
removeSourceMaps(target);

console.log(`Copied ${seen.size} runtime packages to ${target}`);
