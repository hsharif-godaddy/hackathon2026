// Conditional import for server-only AsyncLocalStorage
let AsyncLocalStorage: any;
if (typeof window === 'undefined') {
  // Server-side: import AsyncLocalStorage
  AsyncLocalStorage = require('async_hooks').AsyncLocalStorage; // eslint-disable-line @typescript-eslint/no-var-requires
} else {
  // Client-side: provide a no-op implementation
  AsyncLocalStorage = class {
    run<T>(context: any, fn: () => T): T {
      return fn();
    }
    getStore() {
      return undefined;
    }
  };
}

/**
 * Log levels similar to agents system
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Log event structure following agents pattern
 */
export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;

  // Request context
  customerId?: string;
  requestId?: string;

  // Optional data
  data?: Record<string, any>;
  error?: Error;
  duration?: number;
  tags?: string[];
  meta?: Record<string, any>;
}

/**
 * Log options for additional context
 */
export interface LogOptions {
  data?: Record<string, any>;
  error?: Error;
  duration?: number;
  tags?: string[];
  meta?: Record<string, any>;
}

/**
 * Request context interface for storing user information
 */
export interface RequestContext {
  customerId: string;     // GoDaddy customer identifier
  requestId?: string;     // Unique request tracking ID
}

/**
 * AsyncLocalStorage instance for request-scoped context
 * Only available on server-side
*/
const asyncLocalStorage = typeof window === 'undefined' ? new AsyncLocalStorage() : new AsyncLocalStorage();

/**
 * Context service for managing request-scoped user context
 */
export class RequestContextService {
  /**
   * Run a function with user context
   */
  static run<T>(context: RequestContext, fn: () => T): T {
    if (asyncLocalStorage) {
      return asyncLocalStorage.run(context, fn);
    }
    // Client-side: just execute the function without context
    return fn();
  }

  /**
   * Get the current request context
   */
  static getContext(): RequestContext | undefined {
    return asyncLocalStorage?.getStore();
  }


  /**
   * Get current customer ID
   */
  static getCustomerId(): string | undefined {
    return asyncLocalStorage?.getStore()?.customerId;
  }

  /**
   * Get current request ID
   */
  static getRequestId(): string | undefined {
    return asyncLocalStorage?.getStore()?.requestId;
  }

  /**
   * Check if context exists
   */
  static hasContext(): boolean {
    return asyncLocalStorage?.getStore() !== undefined;
  }

  /**
   * Get context for logging (formatted string)
   */
  static getLogContext(): string {
    const context = asyncLocalStorage?.getStore();
    if (!context) return '';

    const parts: string[] = [];
    if (context.customerId) parts.push(`customerId:${context.customerId}`);
    if (context.requestId) parts.push(`reqId:${context.requestId}`);

    return parts.length > 0 ? `[${parts.join(' ')}]` : '';
  }
}

/**
 * Context Logger following agents system pattern
 */
export class ContextLogger {
  private static instance: ContextLogger;
  private level: LogLevel = ContextLogger.getDefaultLogLevel();

  /**
   * Get default log level based on environment
   * Checks both NODE_ENV and ENVIRONMENT_NAME (for ECS)
   */
  private static getDefaultLogLevel(): LogLevel {
    const nodeEnv = process.env.NODE_ENV;
    const environmentName = process.env.ENVIRONMENT_NAME || '';

    // Check if either environment variable indicates development
    // Consider "dev-*" environments as development for proper logging format
    const isDevelopment = nodeEnv === 'development' ||
                          ['development', 'pre-development'].includes(environmentName) ||
                          environmentName?.startsWith('dev-');

    return isDevelopment ? 'debug' : 'info';
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ContextLogger {
    if (!ContextLogger.instance) {
      ContextLogger.instance = new ContextLogger();
    }
    return ContextLogger.instance;
  }

  /**
   * Check if log level is enabled
   */
  private isEnabled(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
    const currentLevelIndex = levels.indexOf(this.level);
    const eventLevelIndex = levels.indexOf(level);
    return eventLevelIndex >= currentLevelIndex;
  }

  /**
   * Format message from event and data
   */
  private formatMessage(event: string, data?: any): string {
    if (!data) return event;

    if (typeof data === 'string') {
      return `${event}: ${data}`;
    }

    if (data.message) {
      return `${event}: ${data.message}`;
    }

    return event;
  }

  /**
   * Create log event with context
   */
  private createLogEvent(level: LogLevel, event: string, data?: any, options?: LogOptions): LogEvent {
    const context = RequestContextService.getContext();

    const logEvent: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message: this.formatMessage(event, data),

      // Include request context if available
      ...(context ? {
        customerId: context.customerId,
        requestId: context.requestId
      } : {})
    };

    if (data !== undefined && typeof data === 'object' && !Array.isArray(data)) {
      logEvent.data = data;
    }

    if (options?.error) {
      logEvent.error = options.error;
    }

    if (options?.duration !== undefined) {
      logEvent.duration = options.duration;
    }

    if (options?.tags) {
      logEvent.tags = options.tags;
    }

    if (options?.meta) {
      logEvent.meta = options.meta;
    }

    return logEvent;
  }

  /**
   * Output log event to console with formatting
   */
  private output(logEvent: LogEvent): void {
    const { customerId, requestId } = logEvent;

    // Create context prefix
    const contextParts: string[] = [];
    if (customerId) contextParts.push(`customerId:${customerId}`);
    if (requestId) contextParts.push(`reqId:${requestId}`);

    // Always use structured JSON output (production format)
    // This ensures consistent, machine-parseable logs for FluentBit and log aggregation
    console.log(JSON.stringify(logEvent));
  }

  /**
   * Core logging method
   */
  log(level: LogLevel, event: string, data?: any, options?: LogOptions): void {
    if (!this.isEnabled(level)) {
      return;
    }

    const logEvent = this.createLogEvent(level, event, data, options);
    this.output(logEvent);
  }

  /**
   * Debug level logging
   */
  debug(event: string, data?: any, options?: LogOptions): void {
    this.log('debug', event, data, options);
  }

  /**
   * Info level logging
   */
  info(event: string, data?: any, options?: LogOptions): void {
    this.log('info', event, data, options);
  }

  /**
   * Warning level logging
   */
  warn(event: string, data?: any, options?: LogOptions): void {
    this.log('warn', event, data, options);
  }

  /**
   * Error level logging
   */
  error(event: string, data?: any, options?: LogOptions): void {
    this.log('error', event, data, options);
  }

  /**
   * Fatal level logging
   */
  fatal(event: string, data?: any, options?: LogOptions): void {
    this.log('fatal', event, data, options);
  }
}

/**
 * Global logger instance (lazy-loaded to avoid initialization issues)
 */
let _logger: ContextLogger | null = null;

export const logger = {
  get instance(): ContextLogger {
    if (!_logger) {
      _logger = ContextLogger.getInstance();
    }
    return _logger;
  },

  debug(event: string, data?: any, options?: LogOptions): void {
    this.instance.debug(event, data, options);
  },

  info(event: string, data?: any, options?: LogOptions): void {
    this.instance.info(event, data, options);
  },

  warn(event: string, data?: any, options?: LogOptions): void {
    this.instance.warn(event, data, options);
  },

  error(event: string, data?: any, options?: LogOptions): void {
    this.instance.error(event, data, options);
  },

  fatal(event: string, data?: any, options?: LogOptions): void {
    this.instance.fatal(event, data, options);
  },

  log(level: LogLevel, event: string, data?: any, options?: LogOptions): void {
    this.instance.log(level, event, data, options);
  }
};
