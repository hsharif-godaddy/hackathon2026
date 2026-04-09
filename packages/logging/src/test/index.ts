import pino from 'pino';
import type { AiroLogger, LogLevel, LogContext, LogOptions } from '../types.js';
import { TestDestination } from './handler.js';
import { agentsFormatters, agentsContext } from '../schemas/agents.js';
import { appFormatters } from '../schemas/app.js';

export { TestDestination } from './handler.js';

/**
 * Create a test logger that writes to an in-memory buffer.
 * Returns both the logger and the destination for assertions.
 */
export function createTestLogger(options: {
  schema?: 'agents' | 'app';
  context?: LogContext;
  level?: LogLevel;
  maxEvents?: number;
} = {}): { logger: AiroLogger; destination: TestDestination } {
  const destination = new TestDestination({ maxEvents: options.maxEvents });
  const schema = options.schema || 'agents';

  let formatters: ReturnType<typeof agentsFormatters> | ReturnType<typeof appFormatters>;
  let baseContext: LogContext;

  switch (schema) {
    case 'agents':
      formatters = agentsFormatters();
      baseContext = agentsContext();
      break;
    case 'app':
      formatters = appFormatters();
      baseContext = {};
      break;
    default:
      throw new Error(`Unsupported test logger schema: ${schema}. Use 'agents' or 'app'.`);
  }

  const pinoLogger = pino({
    level: options.level || 'debug',
    formatters,
    timestamp: pino.stdTimeFunctions.isoTime,
  }, destination);

  const context: LogContext = { ...baseContext, ...options.context };

  const logger: AiroLogger = {
    debug(event: string, data?: unknown, opts?: LogOptions) {
      logTo(pinoLogger, 'debug', event, data, opts, context);
    },
    info(event: string, data?: unknown, opts?: LogOptions) {
      logTo(pinoLogger, 'info', event, data, opts, context);
    },
    warn(event: string, data?: unknown, opts?: LogOptions) {
      logTo(pinoLogger, 'warn', event, data, opts, context);
    },
    error(event: string, data?: unknown, opts?: LogOptions) {
      logTo(pinoLogger, 'error', event, data, opts, context);
    },
    fatal(event: string, data?: unknown, opts?: LogOptions) {
      logTo(pinoLogger, 'fatal', event, data, opts, context);
    },
    child(childContext: LogContext): AiroLogger {
      // For tests, return a simple wrapper with merged context
      const merged = { ...context, ...childContext };
      const childPino = pinoLogger.child({});
      return {
        debug(event: string, data?: unknown, opts?: LogOptions) {
          logTo(childPino, 'debug', event, data, opts, merged);
        },
        info(event: string, data?: unknown, opts?: LogOptions) {
          logTo(childPino, 'info', event, data, opts, merged);
        },
        warn(event: string, data?: unknown, opts?: LogOptions) {
          logTo(childPino, 'warn', event, data, opts, merged);
        },
        error(event: string, data?: unknown, opts?: LogOptions) {
          logTo(childPino, 'error', event, data, opts, merged);
        },
        fatal(event: string, data?: unknown, opts?: LogOptions) {
          logTo(childPino, 'fatal', event, data, opts, merged);
        },
        child: (ctx: LogContext) => logger.child({ ...childContext, ...ctx }),
      };
    },
  };

  return { logger, destination };
}

function logTo(
  pinoLogger: pino.Logger,
  level: string,
  event: string,
  data: unknown,
  options: LogOptions | undefined,
  context: LogContext,
): void {
  let message = event;
  if (data && typeof data === 'object' && (data as Record<string, unknown>).name) {
    message += ` ${(data as Record<string, unknown>).name}`;
  }

  const obj: Record<string, unknown> = { event, message, ...context };
  if (data !== undefined && data !== null) {
    obj.data = typeof data === 'object' && !Array.isArray(data) ? data : { value: data };
  }
  if (options?.duration !== undefined) obj.duration = options.duration;
  if (options?.tags) obj.tags = options.tags;
  if (options?.meta) obj.meta = options.meta;
  if (options?.error) obj.error = options.error;

  pinoLogger[level as keyof Pick<pino.Logger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>](obj, message);
}
