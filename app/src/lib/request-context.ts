import type { NextRequest } from 'next/server';

import { getApmTraceIds } from '@/lib/apm-context';
import { ClientLogBuffer } from '@/lib/logging/client-log-buffer';

// Conditional import for server-only AsyncLocalStorage
let AsyncLocalStorage: any;
if (typeof window === 'undefined') {
  // Server-side: import AsyncLocalStorage
  AsyncLocalStorage = require('async_hooks').AsyncLocalStorage; // eslint-disable-line
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
 * Check if running in browser environment
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Check if running in development mode
 *
 * On client: Only NODE_ENV is available
 * On server: Also checks ENVIRONMENT_NAME for ECS deployments
 */
function isDevelopment(): boolean {
  const nodeEnv = process.env.NODE_ENV;

  // NODE_ENV check works for browser or server
  if (nodeEnv === 'development') {
    return true;
  }

  // ENVIRONMENT_NAME is server-side only
  if (!isBrowser()) {
    const environmentName = process.env.ENVIRONMENT_NAME || '';
    if (['development', 'pre-development'].includes(environmentName) ||
        environmentName.startsWith('dev-')) {
      return true;
    }
  }

  return false;
}

/**
 * Log levels similar to agents system
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Log event structure following agents pattern with APM correlation
 */
export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;

  // Request context
  customerId?: string;
  shopperId?: string;
  appId?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  tokenIat?: number;
  tokenHbi?: number;
  tokenExp?: number;
  isPersistent?: boolean;
  authType?: string;

  // APM correlation fields (Elastic APM format)
  'trace.id'?: string;
  'span.id'?: string;
  'transaction.id'?: string;

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
  customerId?: string;
  shopperId?: string;
  appId?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  tokenIat?: number;
  tokenHbi?: number;
  tokenExp?: number;
  isPersistent?: boolean;
  authType?: string;
}

function sanitizeHeader(value: string | null, maxLength = 300): string | undefined {
  if (!value) return undefined;
  return value.slice(0, maxLength);
}

export function createRequestContext(request: NextRequest): RequestContext {
  return {
    // request.nextUrl.pathname is pre-normalized by Next.js and never throws.
    // new URL(request.url).pathname looks equivalent but throws on malformed URLs,
    // which would escape the APM transaction boundary and produce an unlogged 500.
    path: sanitizeHeader(request.nextUrl.pathname),
    method: request.method,
    userAgent: sanitizeHeader(request.headers.get('user-agent')),
  };
}

const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Context service for managing request-scoped user context
 */
export class RequestContextService {
  static run<T>(context: RequestContext, fn: () => T): T {
    return asyncLocalStorage.run(context, fn);
  }

  static getContext(): RequestContext | undefined {
    return asyncLocalStorage.getStore();
  }

  static getCustomerId(): string | undefined {
    return asyncLocalStorage.getStore()?.customerId;
  }

  static hasContext(): boolean {
    return asyncLocalStorage.getStore() !== undefined;
  }

  static getLogContext(): string {
    const context = asyncLocalStorage.getStore();
    if (!context) return '';

    const parts: string[] = [];
    if (context.customerId) parts.push(`customerId:${context.customerId}`);

    return parts.length > 0 ? `[${parts.join(' ')}]` : '';
  }
}

/**
 * Context Logger following agents system pattern
 */
export class ContextLogger {
  private static instance: ContextLogger;
  private level: LogLevel = ContextLogger.getDefaultLogLevel();
  private static clientBaseContext: Record<string, unknown> = {};

  static setClientBaseContext(ctx: Record<string, unknown>): void {
    ContextLogger.clientBaseContext = { ...ContextLogger.clientBaseContext, ...ctx };
  }

  static clearClientBaseContext(): void {
    ContextLogger.clientBaseContext = {};
  }

  static getClientBaseContext(): Record<string, unknown> {
    return ContextLogger.clientBaseContext;
  }

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
   * Extract OpenTelemetry trace context for log correlation
   * Returns trace.id, span.id, and transaction.id for Elastic APM compatibility
   */
  private getTraceContext(): { 'trace.id'?: string; 'span.id'?: string; 'transaction.id'?: string } {
    return getApmTraceIds();
  }

  /**
   * Create log event with context
   */
  private createLogEvent(level: LogLevel, event: string, data?: any, options?: LogOptions): LogEvent {
    const context = RequestContextService.getContext();
    const traceContext = this.getTraceContext();

    const logEvent: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message: this.formatMessage(event, data),

      // Client-side auth token metadata (iat, hbi, exp, authType) stamped by SsoDebugTools on every
      // authState change — active in production for structured log correlation, not debug-only.
      ...(isBrowser() ? ContextLogger.clientBaseContext : {}),

      // Include request context if available
      ...(context ? {
        ...(context.customerId ? { customerId: context.customerId } : {}),
        ...(context.shopperId ? { shopperId: context.shopperId } : {}),
        ...(context.appId ? { appId: context.appId } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
        ...(context.path ? { path: context.path } : {}),
        ...(context.method ? { method: context.method } : {}),
        ...(context.tokenIat !== undefined ? { tokenIat: context.tokenIat } : {}),
        ...(context.tokenHbi !== undefined ? { tokenHbi: context.tokenHbi } : {}),
        ...(context.authType ? { authType: context.authType } : {}),
      } : {}),

      // Include OpenTelemetry trace context for APM log correlation
      ...traceContext
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
   * Includes OpenTelemetry trace correlation fields for APM integration
   *
   * Client-side behavior:
   * - Development: outputs to console for debugging
   * - Production: ships to /api/client-logs endpoint (no console output to customers)
   *
   * Server-side behavior:
   * - Always outputs to console (picked up by FluentBit/Elasticsearch)
   */
  private output(logEvent: LogEvent): void {
    // Serialize error if present
    const logOutput = {
      ...logEvent,
      ...(logEvent.error ? {
        error: {
          message: logEvent.error.message,
          stack: logEvent.error.stack,
          name: logEvent.error.name
        }
      } : {})
    };

    // Client-side: environment-aware logging
    if (isBrowser()) {
      const inDev = isDevelopment();
      // Development: output to console for debugging
      if (inDev) {
        this.consoleOutput(logEvent.level, logOutput);
        return;
      }

      // Production: ship logs to server, no console output
      // Only ship warn+ to reduce volume and avoid exposing debug info
      if (['warn', 'error', 'fatal'].includes(logEvent.level)) {
        this.shipToServer(logOutput);
      }
      return;
    }

    // Server-side logging
    if (isDevelopment()) {
      // Development: Pretty formatted output for readability
      this.prettyServerOutput(logEvent.level, logOutput);
    } else {
      // Production: Structured JSON
      console.log(JSON.stringify(logOutput));
    }
  }

  /**
   * Pretty formatted server-side output for development
   *
   * @param level - Log level
   * @param logOutput - Log data
   */
  private prettyServerOutput(level: LogLevel, logOutput: Record<string, unknown>): void {
    const c = {
      debug: '\x1b[90m',  // gray
      info: '\x1b[32m',   // green
      warn: '\x1b[33m',   // yellow
      error: '\x1b[31m',  // red
      fatal: '\x1b[35m',  // magenta
      reset: '\x1b[0m',
      dim: '\x1b[90m',    // gray/dim
    };

    // Format a value for display
    const fmt = (val: unknown): string | null => {
      if (val === undefined || val === null || val === '') return null;
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      if (typeof val === 'number') return String(val);
      if (typeof val === 'object') {
        if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString().slice(0, 19);
        if (Array.isArray(val)) return `[${val.length}]`;
        const keys = Object.keys(val);
        return keys.length > 0 ? `{${keys.slice(0, 2).join(',')}}` : null;
      }
      const s = String(val);
      // Truncate very long strings (but keep UUIDs intact)
      if (s.length > 80) return s.slice(0, 77) + '...';
      return s;
    };

    const color = c[level] || c.reset;
    const levelStr = level.toUpperCase().padEnd(5);
    const event = logOutput.event || 'unknown';
    const data = logOutput.data as Record<string, unknown> | undefined;

    // Get message from data, skip if it matches event
    const message = data?.message as string | undefined;
    const displayMsg = message && !String(message).startsWith(String(event)) ? ` ${message}` : '';

    // Pick only the most useful fields (skip noise)
    const skipFields = ['timestamp', 'level', 'event', 'trace.id', 'span.id', 'transaction.id', 'url', 'endpoint', 'userAgent', 'method', 'stack'];
    const fields: string[] = [];

    if (data && typeof data === 'object') {
      for (const [key, val] of Object.entries(data)) {
        if (skipFields.includes(key)) continue;
        const display = fmt(val);
        if (display === null) continue;
        fields.push(`${c.dim}${key}=${c.reset}${display}`);
      }
    }

    console.log(`${color}${levelStr}${c.reset} ${event}${displayMsg}`);

    if (process.env.LOCAL_LOG_CONTEXT === 'true') {
      const ctxFields = (['method', 'path', 'customerId', 'shopperId', 'appId', 'authType', 'tokenIat', 'tokenHbi', 'userAgent'] as const)
        .filter(k => logOutput[k])
        .map(k => `${c.dim}${k}=${c.reset}${String(logOutput[k]).slice(0, 60)}`);
      if (ctxFields.length > 0) {
        console.log(`      ${c.dim}ctx:${c.reset} ${ctxFields.join('  ')}`);
      }
    }

    // Show fields indented on next line (max 5 fields)
    if (fields.length > 0) {
      console.log(`      ${fields.slice(0, 5).join('  ')}`);
    }

    // Show errors on separate line
    if (logOutput.error) {
      const err = logOutput.error as { message?: string };
      if (err.message) {
        const errMsg = err.message.length > 60 ? err.message.slice(0, 57) + '...' : err.message;
        console.log(`      ${c.error}→ ${errMsg}${c.reset}`);
      }
    }
  }

  /**
   * Output to browser console using appropriate method
   * Uses CSS styling for colors and native object expansion
   *
   * @param level - Log level to determine console method
   * @param logOutput - Formatted log output object
   */
  private consoleOutput(level: LogLevel, logOutput: Record<string, unknown>): void {
    const colors: Record<string, string> = {
      debug: 'color: #888',
      info: 'color: #2e7d32',
      warn: 'color: #f57c00',
      error: 'color: #d32f2f',
      fatal: 'color: #9c27b0',
    };

    const event = logOutput.event || 'unknown';
    const data = logOutput.data as Record<string, unknown> | undefined;
    const message = data?.message as string | undefined;
    const displayMsg = message && !String(message).startsWith(String(event)) ? ` ${message}` : '';

    // Build clean display
    const levelStr = level.toUpperCase().padEnd(5);
    const style = colors[level] || '';

    // Extract data fields (skip metadata)
    const skipFields = ['timestamp', 'level', 'event', 'trace.id', 'span.id', 'transaction.id'];
    const fields: Record<string, unknown> = {};
    if (data && typeof data === 'object') {
      for (const [key, val] of Object.entries(data)) {
        if (!skipFields.includes(key) && val !== undefined && val !== null && val !== '') {
          fields[key] = val;
        }
      }
    }

    // Use appropriate console method with styled output
    const logFn = level === 'error' || level === 'fatal' ? console.error
      : level === 'warn' ? console.warn
      : level === 'debug' ? console.debug
      : console.info;

    // Log with CSS styling and expandable data object
    if (Object.keys(fields).length > 0) {
      logFn(`%c${levelStr}%c ${event}${displayMsg}`, style, 'color: inherit', fields);
    } else {
      logFn(`%c${levelStr}%c ${event}${displayMsg}`, style, 'color: inherit');
    }

    // Log errors separately
    if (logOutput.error) {
      const err = logOutput.error as { message?: string; stack?: string };
      if (err.message) {
        console.error(`  → ${err.message}`);
      }
    }
  }

  /**
   * Ship log to server endpoint for production client-side logging
   * Uses buffering and batching for efficiency
   *
   * @param logOutput - Formatted log output to ship
   */
  private shipToServer(logOutput: Record<string, unknown>): void {
    // Add to buffer for batched shipping
    ClientLogBuffer.add({
      ...logOutput,
      source: 'client',
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      sessionId: ClientLogBuffer.getSessionId(),
    });
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
  },

  setClientBaseContext(ctx: Record<string, unknown>): void {
    ContextLogger.setClientBaseContext(ctx);
  },

  clearClientBaseContext(): void {
    ContextLogger.clearClientBaseContext();
  }
};
