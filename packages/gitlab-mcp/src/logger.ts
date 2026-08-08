import { pino, type LoggerOptions } from 'pino';

/**
 * Truncate an ID for safe logging.
 *
 * Shows first 4 characters + ".." + last 4 characters to avoid exposing full IDs
 * while maintaining identifiability.
 *
 * @example truncateId("9fd82b35-6789-abcd") → "9fd8..abcd"
 */
export function truncateId(id: string): string {
  // Runtime type guard for CodeQL - ensures string methods are safe
  if (typeof id !== 'string') return String(id);
  if (id.length <= 10) return id;
  return id.substring(0, 4) + '..' + id.slice(-4);
}

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

/**
 * JSON log output mode.
 *
 * When true: Raw pino JSON output (NDJSON) for log aggregators (Loki, ELK, Datadog)
 * When false (default): Human-readable single-line format via pino-pretty
 */
export const LOG_JSON = process.env.LOG_JSON === 'true';

/**
 * Whether the server runs on the stdio transport.
 *
 * Mirrors determineTransportMode() in server.ts (kept inline to avoid a circular
 * import): explicit `stdio` argument, or no PORT environment variable.
 */
const isStdioTransport = process.argv.slice(2).includes('stdio') || !process.env.PORT;

/**
 * Resolved log destination stream.
 *
 * In stdio transport mode stdout carries MCP JSON-RPC frames, so logs are ALWAYS
 * written to stderr regardless of configuration (MCP spec requirement).
 *
 * In HTTP mode (PORT set) the default preserves the container-friendly convention:
 * pino-pretty output goes to stderr, LOG_JSON (NDJSON) output goes to stdout for
 * log-driver ingestion. Set LOG_DESTINATION=stdout|stderr to override.
 */
export const LOG_DESTINATION: 'stdout' | 'stderr' = (() => {
  if (isStdioTransport) return 'stderr';
  const configured = process.env.LOG_DESTINATION;
  if (configured === 'stdout' || configured === 'stderr') return configured;
  return LOG_JSON ? 'stdout' : 'stderr';
})();

/**
 * Log format pattern using nginx-style tokens.
 *
 * Available tokens:
 * - %time  - Timestamp [HH:MM:SS.mmm]
 * - %level - Log level (INFO, WARN, ERROR, DEBUG)
 * - %name  - Logger name (gitlab-mcp)
 * - %msg   - Log message with structured data
 *
 * Presets:
 * - "%msg" (minimal/default) - Message only, for daemonized environments where
 *   journald/systemd already provides timestamp, level, and process name
 * - "[%time] %level (%name): %msg" (full) - Complete format for standalone use
 *
 * @example LOG_FORMAT="%msg"
 * @example LOG_FORMAT="[%time] %level (%name): %msg"
 * @example LOG_FORMAT="%level: %msg"
 */
export const LOG_FORMAT = process.env.LOG_FORMAT ?? '%msg';

/**
 * Determine which fields to include based on LOG_FORMAT tokens.
 */
function getIgnoredFields(format: string): string {
  const ignored: string[] = ['pid', 'hostname'];

  if (!format.includes('%time')) ignored.push('time');
  if (!format.includes('%level')) ignored.push('level');
  if (!format.includes('%name')) ignored.push('name');

  return ignored.join(',');
}

/**
 * Build pino-pretty options based on LOG_FORMAT.
 *
 * Format tokens control field VISIBILITY via the `ignore` list; rendering uses
 * pino-pretty's standard `[time] LEVEL (name): msg` prefix. A custom
 * messageFormat must NOT be set here: transport options cross a worker-thread
 * boundary, so template placeholders like {levelLabel} do not resolve, and the
 * standard prefix would be rendered twice.
 */
export function buildPrettyOptions(format: string): Record<string, unknown> {
  const hasTime = format.includes('%time');

  // Minimal format (just %msg) - no colors, pure message output
  const isMinimal = format.trim() === '%msg';

  return {
    // In stdio mode stdout carries JSON-RPC frames; stderr also keeps stdout
    // clean for CLI tools (list-tools --export)
    destination: LOG_DESTINATION === 'stdout' ? 1 : 2,
    colorize: !isMinimal,
    translateTime: hasTime ? 'HH:MM:ss.l' : false,
    ignore: getIgnoredFields(format),
    hideObject: true, // Structured data is folded into msg by logInfo/logWarn/logError
  };
}

export const createLogger = (name?: string) => {
  const options: LoggerOptions = {
    name,
    level: process.env.LOG_LEVEL ?? 'info',
  };

  // Test mode: no transport and no explicit stream to avoid Jest worker thread leak
  if (isTestEnv) {
    return pino(options);
  }

  // JSON mode: raw pino output (no pretty printing) for log aggregators,
  // routed to the resolved destination (stderr in stdio mode - issue #563)
  if (LOG_JSON) {
    return pino(options, LOG_DESTINATION === 'stdout' ? process.stdout : process.stderr);
  }

  // Plain mode: pino-pretty for human-readable output
  options.transport = {
    target: 'pino-pretty',
    options: buildPrettyOptions(LOG_FORMAT),
  };
  return pino(options);
};

export const logger = createLogger('gitlab-mcp');

// LOG_DESTINATION=stdout cannot be honored on the stdio transport: stdout is
// reserved for MCP JSON-RPC frames. Tell the operator instead of silently obeying.
if (isStdioTransport && process.env.LOG_DESTINATION === 'stdout') {
  logger.warn(
    'LOG_DESTINATION=stdout is ignored in stdio mode: stdout is reserved for JSON-RPC, logs go to stderr',
  );
}

/**
 * Format data object as key=value pairs for plain text logging.
 * Handles nested objects by JSON stringifying them.
 */
function formatDataPairs(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([k, v]) => {
      if (v instanceof Error) {
        return `${k}=${v.stack ?? v.message}`;
      }
      if (v === null || v === undefined) {
        return `${k}=${String(v)}`;
      }
      if (typeof v === 'object') {
        return `${k}=${JSON.stringify(v)}`;
      }
      return `${k}=${String(v)}`;
    })
    .join(' ');
}

/**
 * Log at INFO level with optional structured data.
 *
 * JSON mode: Full structured object for log aggregators (Loki, ELK, Datadog)
 * Plain mode: Single-line with key=value pairs appended to message
 */
export function logInfo(message: string, data?: Record<string, unknown>): void {
  if (LOG_JSON) {
    logger.info(data ?? {}, message);
  } else if (data && Object.keys(data).length > 0) {
    logger.info(`${message} ${formatDataPairs(data)}`);
  } else {
    logger.info(message);
  }
}

/**
 * Log at WARN level with optional structured data.
 */
export function logWarn(message: string, data?: Record<string, unknown>): void {
  if (LOG_JSON) {
    logger.warn(data ?? {}, message);
  } else if (data && Object.keys(data).length > 0) {
    logger.warn(`${message} ${formatDataPairs(data)}`);
  } else {
    logger.warn(message);
  }
}

/**
 * Log at ERROR level with optional structured data.
 */
export function logError(message: string, data?: Record<string, unknown>): void {
  if (LOG_JSON) {
    logger.error(data ?? {}, message);
  } else if (data && Object.keys(data).length > 0) {
    logger.error(`${message} ${formatDataPairs(data)}`);
  } else {
    logger.error(message);
  }
}

/**
 * Log at DEBUG level with optional structured data.
 */
export function logDebug(message: string, data?: Record<string, unknown>): void {
  if (LOG_JSON) {
    logger.debug(data ?? {}, message);
  } else if (data && Object.keys(data).length > 0) {
    logger.debug(`${message} ${formatDataPairs(data)}`);
  } else {
    logger.debug(message);
  }
}
