/**
 * Logging levels
 *
 * - 'debug', 'info', 'warn', 'error' are standard log levels.
 * - 'fatal' should be used for unrecoverable errors that may require application
 *   termination,
 *   whereas 'error' is for recoverable errors.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Minimal logger interface satisfied by both ai-common Logger and external loggers
 * (e.g., agents service Logger). Used by setLoggerFactory to accept any compatible logger.
 */
export interface LoggerLike {
  debug(message: string, data?: any): void
  info(message: string, data?: any): void
  warn(message: string, data?: any): void
  error(message: string, data?: any): void
  fatal?(message: string, data?: any): void
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  enableColors?: boolean;
  enableTimestamps?: boolean;
  format?: 'text' | 'json';
}

/**
 * Log level priorities
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/**
 * ANSI color codes
 */
const COLORS = {
  reset: '\x1b[0m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[35m',
};


/**
 * Simple logger implementation for ai-lib
 * 
 * Provides structured logging with configurable levels and formatting.
 * Designed to be lightweight and suitable for library usage.
 */
export class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? ((process.env.AI_LIB_LOG_LEVEL as LogLevel) || 'info'),
      prefix: config.prefix || '@airo/ai-lib',
      enableColors: config.enableColors ?? ((typeof process !== 'undefined' && process.stdout?.isTTY) ?? false),
      enableTimestamps: config.enableTimestamps ?? true,
      format: config.format ?? (process.env.LOG_FORMAT === 'json' ? 'json' : 'text'),
    };
  }

  /**
   * Check if a log level is enabled
   * 
   * @param level - Log level to check
   * @returns True if the level should be logged
   */
  private isEnabled(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * Format a log message
   * 
   * @param level - Log level
   * @param message - Message to log
   * @returns Formatted log message
   */
  private format(level: LogLevel, message: string): string {
    const parts: string[] = [];

    if (this.config.enableTimestamps) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    const levelStr = level.toUpperCase().padEnd(5);

    if (this.config.enableColors) {
      const color = COLORS[level];
      parts.push(`${color}${levelStr}${COLORS.reset}`);
    } else {
      parts.push(levelStr);
    }

    if (this.config.prefix) {
      parts.push(`[${this.config.prefix}]`);
    }

    parts.push(message);

    return parts.join(' ');
  }

  /**
   * Convert prefix to dot-delimited event name for JSON output.
   * e.g. "@airo/ai-lib:module-name" → "ai-lib.module-name"
   */
  private prefixToEvent(prefix: string): string {
    return prefix.replace(/^@airo\//, '').replace(/:/g, '.');
  }

  /**
   * Write a structured JSON log line to stdout/stderr.
   */
  private logJson(level: LogLevel, message: string, data?: any): void {
    const entry: Record<string, unknown> = {
      level,
      event: this.config.prefix ? this.prefixToEvent(this.config.prefix) : 'ai-lib',
      message,
      service: 'airo-ai-lib',
    };

    if (this.config.enableTimestamps) {
      entry.timestamp = new Date().toISOString();
    }

    if (data !== undefined) {
      entry.data = data;
    }

    let line: string;
    try {
      line = JSON.stringify(entry) + '\n';
    } catch {
      entry.data = '[Circular or Non-serializable Data]';
      line = JSON.stringify(entry) + '\n';
    }

    if (level === 'error' || level === 'fatal') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  /**
   * Log a message at the specified level
   *
   * @param level - Log level
   * @param message - Message to log
   * @param data - Optional data to include
   */
  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.isEnabled(level)) {
      return;
    }

    if (this.config.format === 'json') {
      this.logJson(level, message, data);
      return;
    }

    let formatted = this.format(level, message);

    if (data !== undefined) {
      try {
        formatted += ' ' + JSON.stringify(data);
      } catch {
        formatted += ' [Circular or Non-serializable Data]';
      }
    }

    if (level === 'error' || level === 'fatal') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else if (level === 'info') {
      console.info(formatted);
    } else {
      console.log(formatted);
    }
  }

  /**
   * Log a debug message
   * 
   * @param message - Message to log
   * @param data - Optional data to include
   */
  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  /**
   * Log an info message
   * 
   * @param message - Message to log
   * @param data - Optional data to include
   */
  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  /**
   * Log a warning message
   * 
   * @param message - Message to log
   * @param data - Optional data to include
   */
  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  /**
   * Log an error message
   * 
   * @param message - Message to log
   * @param data - Optional data to include
   */
  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  /**
   * Log a fatal error message
   * 
   * @param message - Message to log
   * @param data - Optional data to include
   */
  fatal(message: string, data?: any): void {
    this.log('fatal', message, data);
  }

  /**
   * Create a child logger with additional prefix
   * 
   * @param prefix - Additional prefix to add
   * @returns New logger instance
   */
  child(prefix: string): Logger {
    return new Logger({
      ...this.config,
      prefix: this.config.prefix ? `${this.config.prefix}:${prefix}` : prefix,
    });
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Pluggable logger factory. When set, createLogger delegates to this factory
 * instead of creating an ai-common Logger. This allows host applications
 * (e.g., agents service) to route all ai-lib logging through their own
 * structured logger.
 */
let loggerFactory: ((moduleName: string) => LoggerLike) | null = null;

/**
 * Set a custom logger factory for all future createLogger calls.
 * Module-level loggers created before this call resolve lazily on first use,
 * so they will pick up the factory as long as it is set before any logging occurs.
 *
 * @param factory - Function that returns a LoggerLike for a given module name
 */
export function setLoggerFactory(factory: ((moduleName: string) => LoggerLike) | null): void {
  loggerFactory = factory;
}

/**
 * Prefix event names with ai-lib.{moduleName}. to namespace them in Elastic.
 * Strips the module name prefix OR the full ai-lib.{moduleName}. prefix if the
 * event already starts with either (avoids double-prefixing).
 */
function normalizeEvent(moduleName: string, event: string): string {
  const fullPrefix = `ai-lib.${moduleName}.`;
  if (event.startsWith(fullPrefix)) return event;
  const modulePrefix = `${moduleName}.`;
  const stripped = event.startsWith(modulePrefix) ? event.slice(modulePrefix.length) : event;
  return `ai-lib.${moduleName}.${stripped}`;
}

/**
 * Create a logger for a specific module.
 *
 * When a logger factory has been set via setLoggerFactory, returns a thin
 * forwarding wrapper that resolves the factory-provided logger on first use
 * and normalizes event names to dot-delimited format with an ai-lib. prefix.
 *
 * When no factory is set, returns the default ai-common Logger (existing behavior).
 *
 * @param moduleName - Name of the module
 * @returns Logger-compatible instance
 */
export function createLogger(moduleName: string): LoggerLike {
  let delegate: LoggerLike | null = null;

  // Captured at resolve-time so normalization stays consistent with the delegate,
  // even if loggerFactory were ever reassigned after resolution.
  let useNormalization = false;

  const resolve = (): LoggerLike => {
    if (!delegate) {
      useNormalization = !!loggerFactory;
      delegate = loggerFactory
        ? loggerFactory(moduleName)
        : new Logger({ prefix: `@airo/ai-lib:${moduleName}` });
    }
    return delegate;
  };

  const emit = (level: 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: string, data?: any) => {
    const d = resolve();
    const event = useNormalization ? normalizeEvent(moduleName, message) : message;
    d[level]?.(event, data);
  };

  return {
    debug(message: string, data?: any) { emit('debug', message, data); },
    info(message: string, data?: any) { emit('info', message, data); },
    warn(message: string, data?: any) { emit('warn', message, data); },
    error(message: string, data?: any) { emit('error', message, data); },
    fatal(message: string, data?: any) { emit('fatal', message, data); },
  };
}

