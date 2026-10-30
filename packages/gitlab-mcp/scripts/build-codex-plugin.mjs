import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Release packaging is a repository build step, not a server command.
if (process.argv.length !== 3 || process.argv[2].startsWith('-'))
  throw new Error('Usage: node scripts/build-codex-plugin.mjs <output-directory>');
const require = createRequire(import.meta.url);
const { buildPlugin } = require('../dist/src/cli/plugin/build.js');
const result = buildPlugin({
  flavor: 'private',
  marketplaceZip: true,
  outDir: resolve(process.argv[2]),
});
console.log(result.zipPath);
console.log(result.checksumPath);
