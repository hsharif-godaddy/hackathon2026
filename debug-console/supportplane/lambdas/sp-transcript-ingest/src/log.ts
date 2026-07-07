/**
 * Minimal structured logger for the isolated Lambda package.
 *
 * Mirrors the `logger.info(event, data, { error })` shape used by debug-console
 * so the vendored parse logic (parse.ts) reads verbatim, but emits a single JSON
 * line via `console` (the style the handler already uses; picked up by Loki).
 */
type LogData = Record<string, unknown>;
interface LogExtra {
  error?: Error;
}

type Level = 'info' | 'warn' | 'error' | 'debug';

function emit(level: Level, event: string, data?: LogData, extra?: LogExtra): void {
  const line: Record<string, unknown> = { level, msg: event, ...(data ?? {}) };
  if (extra?.error) {
    line.error = extra.error.message;
  }
  const sink: (message: string) => void =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(JSON.stringify(line));
}

export const logger = {
  info(event: string, data?: LogData): void {
    emit('info', event, data);
  },
  warn(event: string, data?: LogData, extra?: LogExtra): void {
    emit('warn', event, data, extra);
  },
  error(event: string, data?: LogData, extra?: LogExtra): void {
    emit('error', event, data, extra);
  },
  debug(event: string, data?: LogData): void {
    emit('debug', event, data);
  },
};
