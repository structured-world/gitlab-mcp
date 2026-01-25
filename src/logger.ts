import { pino, type LoggerOptions } from "pino";

const isTestEnv = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;

/**
 * JSON log output mode.
 *
 * When true: Raw pino JSON output (NDJSON) for log aggregators (Loki, ELK, Datadog)
 * When false (default): Human-readable single-line format via pino-pretty
 */
export const LOG_JSON = process.env.LOG_JSON === "true";

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
      options: {
        colorize: true,
        translateTime: true,
        ignore: "pid,hostname",
        destination: 2, // stderr - keeps stdout clean for CLI tools (list-tools --export)
      },
    };
  }

  return pino(options);
};

export const logger = createLogger("gitlab-mcp");
