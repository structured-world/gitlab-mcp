import { pino, type LoggerOptions } from "pino";

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
  if (typeof id !== "string") return String(id);
  if (id.length <= 10) return id;
  return id.substring(0, 4) + ".." + id.slice(-4);
}

const isTestEnv = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;

/**
 * JSON log output mode.
 *
 * When true: Raw pino JSON output (NDJSON) for log aggregators (Loki, ELK, Datadog)
 * When false (default): Human-readable single-line format via pino-pretty
 */
export const LOG_JSON = process.env.LOG_JSON === "true";

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
export const LOG_FORMAT = process.env.LOG_FORMAT ?? "%msg";

/**
 * Convert LOG_FORMAT tokens to pino-pretty messageFormat template.
 *
 * Transforms nginx-style tokens to pino-pretty placeholders:
 * - %time  → {time}
 * - %level → {levelLabel}
 * - %name  → {name}
 * - %msg   → {msg}
 */
function convertToPinoFormat(format: string): string {
  return format
    .replace(/%time/g, "{time}")
    .replace(/%level/g, "{levelLabel}")
    .replace(/%name/g, "{name}")
    .replace(/%msg/g, "{msg}");
}

/**
 * Determine which fields to include based on LOG_FORMAT tokens.
 */
function getIgnoredFields(format: string): string {
  const ignored: string[] = ["pid", "hostname"];

  if (!format.includes("%time")) ignored.push("time");
  if (!format.includes("%level")) ignored.push("level");
  if (!format.includes("%name")) ignored.push("name");

  return ignored.join(",");
}

/**
 * Build pino-pretty options based on LOG_FORMAT
 */
function buildPrettyOptions(format: string): Record<string, unknown> {
  const baseOptions = {
    destination: 2, // stderr - keeps stdout clean for CLI tools (list-tools --export)
  };

  const hasTime = format.includes("%time");
  const pinoFormat = convertToPinoFormat(format);
  const ignored = getIgnoredFields(format);

  // Minimal format (just %msg) - no colors, pure message output
  const isMinimal = format.trim() === "%msg";

  return {
    ...baseOptions,
    colorize: !isMinimal,
    translateTime: hasTime ? "HH:MM:ss.l" : false,
    ignore: ignored,
    messageFormat: pinoFormat,
    hideObject: true, // Hide the JSON object, use messageFormat only
  };
}

export const createLogger = (name?: string) => {
  const options: LoggerOptions = {
    name,
    level: process.env.LOG_LEVEL ?? "info",
  };

  // JSON mode: raw pino output (no pretty printing) for log aggregators
  // Plain mode: pino-pretty for human-readable output
  // Test mode: skip transport to avoid Jest worker thread leak
  if (!isTestEnv && !LOG_JSON) {
    options.transport = {
      target: "pino-pretty",
      options: buildPrettyOptions(LOG_FORMAT),
    };
  }

  return pino(options);
};

export const logger = createLogger("gitlab-mcp");

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
      if (typeof v === "object") {
        return `${k}=${JSON.stringify(v)}`;
      }
      return `${k}=${String(v)}`;
    })
    .join(" ");
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
