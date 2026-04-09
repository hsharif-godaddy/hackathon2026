import type { AiroLogger, LogLevel, LogContext, LogOptions, LogEvent } from '../types.js';
import { ClientLogBuffer } from './buffer.js';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function isDevelopment(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'development') return true;
  if (!isBrowser()) {
    const envName = process.env.ENVIRONMENT_NAME || '';
    if (['development', 'pre-development'].includes(envName) || envName.startsWith('dev-')) {
      return true;
    }
  }
  return false;
}

function isLevelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);
}

function formatMessage(event: string, data?: unknown): string {
  if (!data) return event;
  if (typeof data === 'string') return `${event}: ${data}`;
  if (typeof data === 'object' && data !== null && 'message' in data) {
    return `${event}: ${(data as { message: string }).message}`;
  }
  return event;
}

const CSS_COLORS: Record<LogLevel, string> = {
  debug: 'color: #888',
  info: 'color: #2e7d32',
  warn: 'color: #f57c00',
  error: 'color: #d32f2f',
  fatal: 'color: #9c27b0',
};

function consoleMethod(level: LogLevel) {
  if (level === 'error' || level === 'fatal') return console.error;
  if (level === 'warn') return console.warn;
  if (level === 'debug') return console.debug;
  return console.info;
}

function browserDevOutput(level: LogLevel, event: string, data?: Record<string, unknown>, options?: LogOptions): void {
  const levelStr = level.toUpperCase().padEnd(5);
  const msg = formatMessage(event, data);
  const log = consoleMethod(level);

  if (data && Object.keys(data).length > 0) {
    log(`%c${levelStr}%c ${msg}`, CSS_COLORS[level], 'color: inherit', data);
  } else {
    log(`%c${levelStr}%c ${msg}`, CSS_COLORS[level], 'color: inherit');
  }

  if (options?.error?.message) {
    console.error(`  -> ${options.error.message}`);
  }
}

function buildLogEvent(
  level: LogLevel,
  event: string,
  data: unknown,
  options: LogOptions | undefined,
  context: LogContext,
  contextProvider?: () => Record<string, unknown>,
): LogEvent {
  const logEvent: LogEvent = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message: formatMessage(event, data),
  };

  // Merge context
  if (context.customerId) logEvent.customerId = context.customerId;

  // Dynamic context (APM traces)
  if (contextProvider) {
    Object.assign(logEvent, contextProvider());
  }

  if (data !== undefined && data !== null && typeof data === 'object' && !Array.isArray(data)) {
    logEvent.data = data as Record<string, unknown>;
  }

  if (options?.error) {
    logEvent.error = {
      name: options.error.name,
      message: options.error.message,
      ...(options.error.stack ? { stack: options.error.stack } : {}),
    };
  }
  if (options?.duration !== undefined) logEvent.duration = options.duration;
  if (options?.tags) logEvent.tags = options.tags;
  if (options?.meta) logEvent.meta = options.meta;

  return logEvent;
}

function shipToServer(logEvent: LogEvent): void {
  // Serialize error for transport
  const output: Record<string, unknown> = { ...logEvent };
  if (logEvent.error) {
    output.error = {
      message: logEvent.error.message,
      stack: logEvent.error.stack,
      name: logEvent.error.name,
    };
  }

  ClientLogBuffer.add({
    ...output,
    source: 'client',
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    sessionId: ClientLogBuffer.getSessionId(),
  });
}

export interface CreateClientLoggerOptions {
  level?: LogLevel;
  context?: LogContext;
  contextProvider?: () => Record<string, unknown>;
}

/**
 * Create a client-side logger with the same AiroLogger interface.
 *
 * - Dev: console output with CSS colors and expandable objects
 * - Prod: warn+ buffered and shipped to /api/client-logs (no console output)
 */
export function createClientLogger(options: CreateClientLoggerOptions = {}): AiroLogger {
  const level = options.level || (isDevelopment() ? 'debug' : 'info');
  const context = options.context || {};
  const contextProvider = options.contextProvider;
  const inDev = isDevelopment();

  function log(logLevel: LogLevel, event: string, data?: unknown, opts?: LogOptions): void {
    if (!isLevelEnabled(logLevel, level)) return;

    if (isBrowser()) {
      if (inDev) {
        const safeData = (typeof data === 'object' && data !== null && !Array.isArray(data))
          ? data as Record<string, unknown>
          : undefined;
        browserDevOutput(logLevel, event, safeData, opts);
        return;
      }
      // Production: only ship warn+
      if (['warn', 'error', 'fatal'].includes(logLevel)) {
        const logEvent = buildLogEvent(logLevel, event, data, opts, context, contextProvider);
        shipToServer(logEvent);
      }
      return;
    }

    // Server-side fallback (SSR): JSON to console
    const logEvent = buildLogEvent(logLevel, event, data, opts, context, contextProvider);
    console.log(JSON.stringify(logEvent));
  }

  const logger: AiroLogger = {
    debug: (event, data?, opts?) => log('debug', event, data, opts),
    info: (event, data?, opts?) => log('info', event, data, opts),
    warn: (event, data?, opts?) => log('warn', event, data, opts),
    error: (event, data?, opts?) => log('error', event, data, opts),
    fatal: (event, data?, opts?) => log('fatal', event, data, opts),
    child(childContext: LogContext): AiroLogger {
      return createClientLogger({
        level,
        context: { ...context, ...childContext },
        contextProvider,
      });
    },
  };

  return logger;
}
