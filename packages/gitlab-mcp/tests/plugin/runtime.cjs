const { createRequire } = require('node:module');
const { join } = require('node:path');

const runtimePath = process.env.PLUGIN_RUNTIME_ROOT;
if (!runtimePath) throw new Error('Run plugin contracts through qualify-codex-plugin.mjs.');
module.exports = { runtimePath, runtimeRequire: createRequire(join(runtimePath, 'main.js')) };
