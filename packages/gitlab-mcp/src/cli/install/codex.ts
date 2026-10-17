/**
 * Codex installer: drives the Codex CLI (`codex mcp list|get|add|remove`) so
 * Codex itself edits config.toml and keeps every unrelated setting.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sync as spawnSync } from 'cross-spawn';
import { parse as parseToml } from 'smol-toml';
import { BackupResult, InstallResult } from './types';
import { isRemoteServerConfig, McpServerConfig } from '../init/types';
import { createBackup, restoreBackup } from './backup';

/** Name of the entry this installer manages; other GitLab entries are only reported. */
export const CODEX_SERVER_NAME = 'gitlab';
const CODEX_COMMAND = 'codex';
const PACKAGE_PATTERN = /@structured-world\/gitlab-mcp(?:@[^\s/]*)?$/;
const CHECKOUT_PATTERN =
  /gitlab-mcp[\\/](?:packages[\\/]gitlab-mcp[\\/])?dist[\\/]src[\\/]main\.js$/;
// The executable a global npm install puts on PATH (`.cmd`/`.ps1` shims on Windows).
// Only the command is matched: `npx gitlab-mcp` runs an unrelated unscoped package.
const GLOBAL_BIN_PATTERN = /(?:^|[\\/])gitlab-mcp(?:\.cmd|\.ps1|\.exe)?$/i;

/** Transport of a configured server as `codex mcp list --json` reports it. */
export type CodexTransport =
  | { type: 'stdio'; command: string; args?: string[] | null; env?: Record<string, string> | null }
  | { type: 'streamable_http'; url: string };

export interface CodexServer {
  name: string;
  transport: CodexTransport;
  /** False when a higher-precedence configuration disables the server. */
  enabled?: boolean;
  disabled_reason?: string | null;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function runCodex(args: string[], interactive = false): RunResult {
  // cross-spawn runs npm's codex.cmd shim on Windows without a shell, so
  // arguments with spaces or cmd.exe metacharacters pass through intact.
  const result = spawnSync(CODEX_COMMAND, args, {
    stdio: interactive ? 'inherit' : 'pipe',
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    error: result.error,
  };
}

function failure(result: RunResult): string {
  return (
    result.error?.message ??
    (result.stderr.trim() || result.stdout.trim() || `codex exited with ${result.status}`)
  );
}

/** Path of the Codex configuration file, honouring CODEX_HOME. */
export function codexConfigPath(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
}

/** Every server Codex runs, including those installed plugins provide. */
export function listCodexServers(): CodexServer[] {
  const result = runCodex(['mcp', 'list', '--json']);
  if (result.status !== 0) throw new Error(`codex mcp list failed: ${failure(result)}`);
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(parsed)) throw new Error('codex mcp list returned an unexpected format');
  return parsed as CodexServer[];
}

function getCodexServer(name: string): CodexServer | undefined {
  const result = runCodex(['mcp', 'get', name, '--json']);
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout) as CodexServer;
  } catch {
    // Unreadable output proves nothing about what was saved.
    return undefined;
  }
}

/** True when the entry runs GitLab MCP, by name, package, checkout or endpoint. */
export function isGitlabMcpServer(server: CodexServer, target?: McpServerConfig): boolean {
  if (server.name === CODEX_SERVER_NAME || server.name.startsWith('gitlab-mcp')) return true;
  const transport = server.transport;
  if (transport.type === 'stdio') {
    return (
      GLOBAL_BIN_PATTERN.test(transport.command) ||
      [transport.command, ...(transport.args ?? [])].some(
        (part) => PACKAGE_PATTERN.test(part) || CHECKOUT_PATTERN.test(part),
      )
    );
  }
  return target !== undefined && isRemoteServerConfig(target) && transport.url === target.url;
}

function matches(server: CodexServer, config: McpServerConfig): boolean {
  const transport = server.transport;
  if (isRemoteServerConfig(config)) {
    return transport.type === 'streamable_http' && transport.url === config.url;
  }
  if (transport.type !== 'stdio') return false;
  // Codex writes no env table when none was given, and lists the saved values verbatim.
  const saved = transport.env ?? {};
  const wanted = Object.entries(config.env);
  return (
    transport.command === config.command &&
    JSON.stringify(transport.args ?? []) === JSON.stringify(config.args) &&
    Object.keys(saved).length === wanted.length &&
    wanted.every(([key, value]) => saved[key] === value)
  );
}

function addArgs(config: McpServerConfig): string[] {
  if (isRemoteServerConfig(config)) return ['mcp', 'add', CODEX_SERVER_NAME, '--url', config.url];
  const env = Object.entries(config.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  return ['mcp', 'add', CODEX_SERVER_NAME, ...env, '--', config.command, ...config.args];
}

function duplicateNotes(servers: CodexServer[], config: McpServerConfig): string[] {
  return servers
    .filter((s) => s.name !== CODEX_SERVER_NAME && isGitlabMcpServer(s, config))
    .map(
      (s) =>
        `"${s.name}" also runs GitLab MCP, so Codex lists its tools twice; ` +
        `remove the one you do not use (codex mcp remove ${s.name}, or disable the plugin).`,
    );
}

/** Removes the managed entry; returns the reason when it was left in place. */
function removeExisting(configPath: string, backup: BackupResult | undefined): string | undefined {
  // Removing the old entry is undoable only through the backup.
  if (backup && !backup.created) {
    return `Could not back up ${configPath}: ${backup.error ?? 'unknown error'}`;
  }
  const removed = runCodex(['mcp', 'remove', CODEX_SERVER_NAME]);
  if (removed.status !== 0) {
    return `Failed to remove the existing gitlab entry: ${failure(removed)}`;
  }
  return undefined;
}

/**
 * True when the user's own config.toml defines the managed entry. `mcp list`
 * also reports servers from plugins and project configuration, which
 * `mcp remove` cannot edit, and `mcp remove` exits 0 for a missing name.
 */
function hasGlobalEntry(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  const servers = parseToml(readFileSync(configPath, 'utf8')).mcp_servers;
  return (
    typeof servers === 'object' && servers !== null && Object.hasOwn(servers, CODEX_SERVER_NAME)
  );
}

/**
 * Undoes a failed add and says how: the backup is restored, or, when there was
 * no entry before, the one Codex saved is removed.
 */
function rollBack(hadEntry: boolean, backupPath: string | undefined, configPath: string): string {
  if (backupPath !== undefined && restoreBackup(backupPath, configPath)) {
    return '; the previous Codex configuration was restored';
  }
  if (hadEntry || !hasGlobalEntry(configPath)) return '';
  runCodex(['mcp', 'remove', CODEX_SERVER_NAME]);
  return hasGlobalEntry(configPath) ? '' : '; the partly saved gitlab entry was removed';
}

/**
 * Registers GitLab MCP in Codex. An existing `gitlab` entry is replaced only
 * with `force`; GitLab MCP registered under other names, including by an
 * installed plugin, is reported and left alone.
 */
export function installCodex(config: McpServerConfig, force: boolean): InstallResult {
  const client = 'codex' as const;
  const configPath = codexConfigPath();
  let servers: CodexServer[];
  try {
    servers = listCodexServers();
  } catch (error) {
    return { client, success: false, error: (error as Error).message };
  }

  const notes = duplicateNotes(servers, config);
  let existing: boolean;
  try {
    existing = hasGlobalEntry(configPath);
  } catch (error) {
    const reason = (error as Error).message;
    return { client, success: false, error: `Cannot read ${configPath}: ${reason}`, notes };
  }
  if (!existing && servers.some((s) => s.name === CODEX_SERVER_NAME)) {
    return {
      client,
      success: false,
      error:
        'Codex already runs a server named "gitlab" from a plugin or project configuration; ' +
        'disable it there before installing.',
      configPath,
      notes,
    };
  }

  if (existing && !force) {
    return {
      client,
      success: false,
      error: 'gitlab-mcp is already configured. Use --force to overwrite.',
      wasAlreadyConfigured: true,
      configPath,
      notes,
    };
  }

  const backup = existsSync(configPath) ? createBackup({ configPath }) : undefined;
  const backupPath = backup?.created ? backup.backupPath : undefined;
  if (existing) {
    const error = removeExisting(configPath, backup);
    if (error) return { client, success: false, error, backupPath, configPath, notes };
  }

  // A remote server starts the browser sign-in right away; it needs the terminal.
  const added = runCodex(addArgs(config), isRemoteServerConfig(config));
  const applied = getCodexServer(CODEX_SERVER_NAME);

  if (!applied || !matches(applied, config)) {
    const error = `codex mcp add failed: ${failure(added)}${rollBack(existing, backupPath, configPath)}`;
    return { client, success: false, error, backupPath, configPath, notes };
  }

  // A project, system or managed config.toml can disable the server; the user's
  // own entry is correct, so it stays and the reason is reported.
  if (applied.enabled === false) {
    const reason = applied.disabled_reason ?? 'no reason given';
    const error = `Codex saved the gitlab entry but keeps it disabled: ${reason}`;
    return { client, success: false, error, backupPath, configPath, notes };
  }

  if (added.status !== 0 && isRemoteServerConfig(config)) {
    notes.push(`Sign-in did not complete; run: codex mcp login ${CODEX_SERVER_NAME}`);
  }

  return {
    client,
    success: true,
    backupPath,
    configPath,
    wasAlreadyConfigured: existing,
    notes,
  };
}

const TOML_SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '\\': String.raw`\\`,
  '"': String.raw`\"`,
  '\n': String.raw`\n`,
  '\t': String.raw`\t`,
  '\r': String.raw`\r`,
};

/** TOML basic string (TOML 1.0, "Basic strings"). */
export function tomlString(value: string): string {
  let escaped = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const short = TOML_SHORT_ESCAPES[char];
    if (short !== undefined) escaped += short;
    // Other control characters have no short escape.
    else if (code < 0x20 || code === 0x7f) {
      escaped += String.raw`\u` + code.toString(16).padStart(4, '0');
    } else escaped += char;
  }
  return `"${escaped}"`;
}

/** The config.toml entry `installCodex` produces, for --show. */
export function codexConfigPreview(config: McpServerConfig): string {
  const lines = [`[mcp_servers.${CODEX_SERVER_NAME}]`];
  if (isRemoteServerConfig(config)) {
    lines.push(`url = ${tomlString(config.url)}`);
    return lines.join('\n');
  }
  lines.push(
    `command = ${tomlString(config.command)}`,
    `args = [${config.args.map(tomlString).join(', ')}]`,
  );
  const env = Object.entries(config.env);
  if (env.length > 0) {
    lines.push('', `[mcp_servers.${CODEX_SERVER_NAME}.env]`);
    for (const [key, value] of env) {
      // Bare keys are A-Za-z0-9_- (TOML 1.0, "Keys"); anything else is quoted.
      lines.push(`${/^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key)} = ${tomlString(value)}`);
    }
  }
  return lines.join('\n');
}
