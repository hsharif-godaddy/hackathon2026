import { nanoid } from 'nanoid';
import type { 
  ILogger, 
  LogLevel, 
  LogEvent, 
  LogContext, 
  LogOptions, 
  LoggerConfig, 
  LogHandler 
} from './types.js';
import { validateLogEvent, sanitizeLogEvent } from './schemas/index.js';
import { createConfigFromEnvironment } from './config.js';

/**
 * Core Logger implementation
 */
export class Logger implements ILogger {
  private static instance: Logger | null = null;
  private static config: LoggerConfig | null = null;

  private context: LogContext;
  private handlers: LogHandler[];
  private level: LogLevel;
  private enabledDomains: Set<string> | null;
  private disabledDomains: Set<string>;
  private optInDomains: Set<string>;

  constructor(config: LoggerConfig, context: LogContext = {}) {
    this.context = { ...context };
    this.handlers = config.handlers;
    this.level = config.level;
    this.enabledDomains = config.enabledDomains ? new Set(config.enabledDomains) : null;
    this.disabledDomains = new Set(config.disabledDomains || []);
    this.optInDomains = new Set(config.optInDomains || []);
  }

  /**
   * Configure the global logger instance
   */
  static configure(config: LoggerConfig): void {
    Logger.config = config;
    Logger.instance = new Logger(config, config.context || {});
  }

  /**
   * Get or create the global logger instance
   */
  static getInstance(): Logger {
    if (!Logger.instance) {
      const defaultConfig = createConfigFromEnvironment();
      Logger.configure(defaultConfig);
    }
    return Logger.instance!;
  }

  /**
   * Create a new logger with additional context
   */
  static create(context?: LogContext): Logger {
    const instance = Logger.getInstance();
    return context ? instance.child(context) : instance;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): Logger {
    const config: LoggerConfig = {
      level: this.level,
      handlers: this.handlers,
    };
    
    if (this.enabledDomains) {
      config.enabledDomains = Array.from(this.enabledDomains);
    }
    
    if (this.disabledDomains.size > 0) {
      config.disabledDomains = Array.from(this.disabledDomains);
    }
    
    if (this.optInDomains.size > 0) {
      config.optInDomains = Array.from(this.optInDomains);
    }

    const childLogger = new Logger(config, { ...this.context, ...context });
    return childLogger;
  }

  /**
   * Create a temporary logger with additional context for a single operation
   */
  withContext(context: LogContext): Logger {
    return this.child(context);
  }

  /**
   * Check if a log level is enabled
   */
  isEnabled(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
    const currentLevelIndex = levels.indexOf(this.level);
    const targetLevelIndex = levels.indexOf(level);
    return targetLevelIndex >= currentLevelIndex;
  }

  /**
   * Check if a domain/subdomain is enabled for logging
   * Supports hierarchical filtering with prefix matching
   * 
   * Priority (highest to lowest):
   * 1. Prefix match in enabledDomains (if set) - allowlist mode
   * 2. Prefix match in disabledDomains - blocklist mode
   * 3. Prefix match in optInDomains - requires explicit enablement
   * 4. Default to enabled
   */
  isDomainEnabled(event: string): boolean {
    if (!event) {
      return true;
    }
    
    // If enabledDomains is set (allowlist mode), check if event starts with any enabled domain
    if (this.enabledDomains) {
      for (const enabledDomain of this.enabledDomains) {
        if (event === enabledDomain || event.startsWith(enabledDomain + '.')) {
          return true;
        }
      }
      return false;
    }
    
    // Check disabled domains (blocklist) - prefix match
    for (const disabledDomain of this.disabledDomains) {
      if (event === disabledDomain || event.startsWith(disabledDomain + '.')) {
        return false;
      }
    }
    
    // Check opt-in domains (require explicit enablement) - prefix match
    if (this.optInDomains.size > 0) {
      for (const optInDomain of this.optInDomains) {
        if (event === optInDomain || event.startsWith(optInDomain + '.')) {
          return false; // Requires opt-in but not explicitly enabled
        }
      }
    }
    
    // Default to enabled
    return true;
  }

  /**
   * Core logging method
   */
  log(level: LogLevel, event: string, data?: any, options?: LogOptions): void {
    // Check if level is enabled
    if (!this.isEnabled(level)) {
      return;
    }

    // Check if domain is enabled
    if (!this.isDomainEnabled(event)) {
      return;
    }

    // Create log event
    const logEvent: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message: this.formatMessage(event, data),
      ...this.context,
    };

    if (data !== undefined) {
      logEvent.data = data;
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
    
    if (options?.error) {
      logEvent.error = options.error;
    }

    // Validate event schema
    try {
      validateLogEvent(logEvent);
    } catch (error) {
      // Log validation error but don't throw to avoid breaking application
      console.error('Log event validation failed:', error, logEvent);
      return;
    }

    // Sanitize the event before sending to handlers
    const sanitizedEvent = sanitizeLogEvent(logEvent);

    // Send to handlers
    for (const handler of this.handlers) {
      try {
        const result = handler.handle(sanitizedEvent);
        if (result instanceof Promise) {
          result.catch(error => {
            console.error('Log handler error:', error);
          });
        }
      } catch (error) {
        console.error('Log handler error:', error);
      }
    }
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
   * Warn level logging
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

  /**
   * Format a human-readable message from event and data
   */
  private formatMessage(event: string, data?: any): string {
    // Convert event to human readable format
    const parts = event.split('.');
    const action = parts[parts.length - 1] || '';
    const domain = parts[0] || '';
    
    let message = `${domain}: ${action}`;
    
    // Add contextual information
    if (data) {
      if (typeof data === 'string') {
        message = data;
      } else if (data && typeof data === 'object') {
        if (data.name) {
          message += ` ${data.name}`;
        } else if (data.id) {
          message += ` ${data.id}`;
        }
      }
    }
    
    return message;
  }

  /**
   * Flush all handlers
   */
  async flush(): Promise<void> {
    await Promise.all(
      this.handlers
        .filter(handler => handler.flush)
        .map(handler => handler.flush!())
    );
  }
}

/**
 * Global logger instance - convenience export
 */
export const logger = Logger.create();

/**
 * Create performance timer for measuring durations
 */
export function createTimer() {
  const start = Date.now();
  return {
    end(): number {
      return Date.now() - start;
    }
  };
}

/**
 * Generate a unique request ID for correlation
 */
export function generateRequestId(): string {
  return nanoid(8);
}

/**
 * Wrap an airo Logger as a pino-compatible logger.
 * Adapts pino-style (meta, message) calls to airo's (event, data) convention.
 */
export function toPinoLogger(airoLogger: Logger) {
  function normalize(...args: any[]): [string, any] {
    if (typeof args[0] === 'string') {return [args[0], args[1]];}
    return [typeof args[1] === 'string' ? args[1] : 'log', args[0]];
  }

  return {
    debug: (...args: any[]) => airoLogger.debug(...normalize(...args)),
    info: (...args: any[]) => airoLogger.info(...normalize(...args)),
    warn: (...args: any[]) => airoLogger.warn(...normalize(...args)),
    error: (...args: any[]) => airoLogger.error(...normalize(...args)),
    child: (metadata: Record<string, any>) => toPinoLogger(airoLogger.child(metadata)),
  };
}