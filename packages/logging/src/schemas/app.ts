import type pino from 'pino';

/**
 * App schema profile.
 *
 * Production JSON:
 * {timestamp, level(lowercase), event, message, customerId,
 *  trace.id, span.id, transaction.id, data, error, duration, tags, meta}
 *
 * The contextProvider callback (passed at logger creation) supplies
 * APM trace IDs and customerId at log-time.
 */
export function appFormatters(): pino.LoggerOptions['formatters'] {
  return {
    level(label: string) {
      return { level: label };
    },
    log(obj: Record<string, unknown>) {
      return obj;
    },
  };
}
