import pino from 'pino';
import type {
  AiroLogger,
  LogLevel,
  LogContext,
  LogOptions,
  LogEvent,
  CreateLoggerOptions,
} from '../types.js';
import { isDomainEnabled } from '../domain/filter.js';
import { getLogLevel, getLogFormat, getDomainConfig } from './config.js';
import { agentsFormatters, agentsContext } from '../schemas/agents.js';
import { appFormatters } from '../schemas/app.js';
import { proxyFormatters } from '../schemas/proxy.js';
import { devTransport } from '../dev/transport.js';

const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, fatal: 4,
};

function getFormatters(schema: string): pino.LoggerOptions['formatters'] {
  switch (schema) {
    case 'agents': return agentsFormatters();
    case 'app': return appFormatters();
    case 'proxy': return proxyFormatters();
    default: return appFormatters();
  }
}

function formatMessage(event: string, data?: unknown): string {
  let message = event;

  if (data) {
    if (typeof data === 'string') {
      message = data;
    } else if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (obj.name) message += ` ${obj.name}`;
      else if (obj.id) message += ` ${obj.id}`;
    }
  }

  return message;
}

function createPinoLogger(options: CreateLoggerOptions): pino.Logger {
  const level = options.level || getLogLevel();
  const format = getLogFormat();
  const formatters = getFormatters(options.schema);

  const pinoOptions: pino.LoggerOptions = {
    level,
    formatters,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (options.destination) {
    return pino(pinoOptions, options.destination as pino.DestinationStream);
  }

  if (format === 'dev') {
    const dest = devTransport();
    return pino(pinoOptions, dest);
  }

  return pino(pinoOptions);
}

class PinoAiroLogger implements AiroLogger {
  private pinoLogger: pino.Logger;
  private context: LogContext;
  private domainConfig: ReturnType<typeof getDomainConfig>;
  private contextProvider?: () => Record<string, unknown>;
  private level: LogLevel;

  constructor(
    pinoLogger: pino.Logger,
    context: LogContext,
    domainConfig: ReturnType<typeof getDomainConfig>,
    contextProvider?: () => Record<string, unknown>,
    level?: LogLevel,
  ) {
    this.pinoLogger = pinoLogger;
    this.context = context;
    this.domainConfig = domainConfig;
    this.contextProvider = contextProvider;
    this.level = level || getLogLevel();
  }

  private isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[this.level];
  }

  private log(level: LogLevel, event: string, data?: unknown, options?: LogOptions): void {
    if (!this.isLevelEnabled(level)) return;
    if (!isDomainEnabled(event, this.domainConfig)) return;

    const message = formatMessage(event, data);

    // Build the merging object for Pino
    const obj: Record<string, unknown> = {
      event,
      message,
      ...this.context,
    };

    // Merge dynamic context (APM traces, customerId, etc.)
    if (this.contextProvider) {
      Object.assign(obj, this.contextProvider());
    }

    if (data !== undefined && data !== null) {
      if (typeof data === 'object' && !Array.isArray(data)) {
        obj.data = data;
      } else {
        obj.data = { value: data };
      }
    }

    if (options?.duration !== undefined) obj.duration = options.duration;
    if (options?.tags) obj.tags = options.tags;
    if (options?.meta) obj.meta = options.meta;
    if (options?.error) {
      obj.error = {
        name: options.error.name,
        message: options.error.message,
        ...(options.error.stack ? { stack: options.error.stack } : {}),
        ...(options.error.code !== undefined ? { code: options.error.code } : {}),
      };
    }

    // Route to the right Pino level
    const pinoLevel = level === 'fatal' ? 'fatal' : level;
    this.pinoLogger[pinoLevel](obj, message);
  }

  debug(event: string, data?: unknown, options?: LogOptions): void {
    this.log('debug', event, data, options);
  }

  info(event: string, data?: unknown, options?: LogOptions): void {
    this.log('info', event, data, options);
  }

  warn(event: string, data?: unknown, options?: LogOptions): void {
    this.log('warn', event, data, options);
  }

  error(event: string, data?: unknown, options?: LogOptions): void {
    this.log('error', event, data, options);
  }

  fatal(event: string, data?: unknown, options?: LogOptions): void {
    this.log('fatal', event, data, options);
  }

  child(context: LogContext): AiroLogger {
    return new PinoAiroLogger(
      this.pinoLogger.child({}),
      { ...this.context, ...context },
      this.domainConfig,
      this.contextProvider,
      this.level,
    );
  }
}

/**
 * Create a logger for a specific service schema.
 */
export function createLogger(options: CreateLoggerOptions): AiroLogger {
  const domainConfig = options.domains || getDomainConfig();
  const pinoLogger = createPinoLogger(options);

  // Build initial context from schema defaults + user context
  let context: LogContext = {};
  if (options.schema === 'agents') {
    context = { ...agentsContext(), ...options.context };
  } else {
    context = { ...options.context };
  }

  return new PinoAiroLogger(
    pinoLogger,
    context,
    domainConfig,
    options.contextProvider,
    options.level,
  );
}

/**
 * Convert Error to LogError format
 */
export function errorToLogError(err: Error | unknown): LogEvent['error'] {
  if (!err) return undefined;

  if (err instanceof Error) {
    const code = 'code' in err ? (err as { code: string | number }).code : undefined;
    return {
      name: err.name,
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
      ...(code !== undefined ? { code } : {}),
    };
  }

  if (typeof err === 'object' && err !== null && 'message' in err) {
    const e = err as { name?: string; message: string; stack?: string; code?: string | number };
    return {
      name: e.name || 'Error',
      message: e.message,
      ...(e.stack ? { stack: e.stack } : {}),
      ...(e.code !== undefined ? { code: e.code } : {}),
    };
  }

  return { name: 'UnknownError', message: String(err) };
}

/**
 * Create a performance timer
 */
export function createTimer() {
  const start = Date.now();
  return {
    end(): number {
      return Date.now() - start;
    },
  };
}
