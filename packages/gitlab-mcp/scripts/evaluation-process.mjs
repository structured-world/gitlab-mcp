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

export function runEvaluation(command, args, { cwd, timeoutMs = 180000 }) {
  const taskkill = process.platform === 'win32' ? resolveExecutable('taskkill') : undefined;
  return new Promise((resolveRun, reject) => {
    const child = launch(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    let timeoutError;
    const timer = setTimeout(() => {
      timeoutError = new Error(`Client evaluation timed out after ${timeoutMs}ms`);
      // Kill the isolated group/tree, including MCP children that hold our pipes.
      // https://nodejs.org/api/child_process.html#optionsdetached
      // https://learn.microsoft.com/windows-server/administration/windows-commands/taskkill
      try {
        if (taskkill)
          launchSync(taskkill, ['/T', '/F', '/PID', String(child.pid)], { stdio: 'pipe' });
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') reject(error);
      }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timeoutError) reject(timeoutError);
      else resolveRun({ code, stdout, stderr });
    });
  });
}

export function isMutationCall(call) {
  const name = call.tool ?? call.name;
  if (!name.endsWith('manage_context')) return name.includes('manage_');
  const raw = call.arguments ?? call.input;
  const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return !['show', 'whoami', 'list_profiles', 'list_presets'].includes(args?.action);
}
