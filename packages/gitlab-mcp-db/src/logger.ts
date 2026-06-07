/**
 * Minimal structured logger for the db package, kept local so this package has
 * no runtime dependency on core (core depends on it, not the other way round).
 * Logs to stderr to stay clear of the stdio MCP transport on stdout.
 */
type Meta = Record<string, unknown>;

function emit(level: string, msg: string, meta?: Meta): void {
  const line = JSON.stringify({ level, name: 'gitlab-mcp-db', msg, ...meta });
  process.stderr.write(`${line}\n`);
}

export const logInfo = (msg: string, meta?: Meta): void => emit('info', msg, meta);
export const logError = (msg: string, meta?: Meta): void => emit('error', msg, meta);
export const logDebug = (msg: string, meta?: Meta): void => emit('debug', msg, meta);
