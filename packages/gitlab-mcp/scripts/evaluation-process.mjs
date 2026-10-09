import crossSpawn from 'cross-spawn';
import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

/** Resolve installed tools before entering the isolated evaluation workspace. */
export function resolveExecutable(name, environment = process.env, platform = process.platform) {
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', '.com', ''] : [''];
  const path = Object.entries(environment).find(([key]) => key.toUpperCase() === 'PATH')?.[1];
  for (const directory of (path ?? '').split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = resolve(directory, name + extension);
      try {
        accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return realpathSync(candidate);
      } catch {
        // Continue searching the operator's installed tool directories.
      }
    }
  }
  throw new Error(`Installed executable not found: ${name}`);
}

/** cross-spawn escapes cmd.exe metacharacters for npm's Windows CLI shims. */
export function launch(command, args, options) {
  return crossSpawn(command, args, options);
}

export function launchSync(command, args, options) {
  const result = crossSpawn.sync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout;
}

export function isMutationCall(call) {
  const name = call.tool ?? call.name;
  if (!name.endsWith('manage_context')) return name.includes('manage_');
  const raw = call.arguments ?? call.input;
  const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return !['show', 'whoami', 'list_profiles', 'list_presets'].includes(args?.action);
}
