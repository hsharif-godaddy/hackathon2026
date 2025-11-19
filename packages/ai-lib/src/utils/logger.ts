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
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  enableColors?: boolean;
  enableTimestamps?: boolean;
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
      level: (process.env.AI_LIB_LOG_LEVEL as LogLevel) || 'info',
      prefix: config.prefix || '@airo/ai-lib',
      enableColors: config.enableColors ?? (process.stdout.isTTY ?? false),
      enableTimestamps: config.enableTimestamps ?? true,
      ...config,
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
 * Create a logger for a specific module
 * 
 * @param moduleName - Name of the module
 * @returns Logger instance
 */
export function createLogger(moduleName: string): Logger {
  return new Logger({ prefix: `@airo/ai-lib:${moduleName}` });
}

