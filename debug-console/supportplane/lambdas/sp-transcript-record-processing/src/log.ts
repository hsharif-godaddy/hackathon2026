/**
 * Minimal structured logger for the isolated Lambda package. Emits a single
 * JSON line via `console` (picked up by Loki). Matches the shape used by the
 * ingest Lambda's log.ts so both handlers log consistently.
 */
type LogData = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';

function emit(level: Level, event: string, data?: LogData): void {
  const sink: (message: string) => void =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(JSON.stringify({ level, msg: event, ...(data ?? {}) }));
}

export const logger = {
  info(event: string, data?: LogData): void {
    emit('info', event, data);
  },
  warn(event: string, data?: LogData): void {
    emit('warn', event, data);
  },
  error(event: string, data?: LogData): void {
    emit('error', event, data);
  },
};
