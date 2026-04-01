/**
 * Core logging types and interfaces
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  appId?: string;
  agentId?: string;
  userId?: string;
  requestId?: string;
  conversationId?: string;
  component?: string;
  version?: string;
  [key: string]: any;
}

export interface LogError {
  name: string;
  message: string;
  stack?: string | undefined;
  code?: string | number | undefined;
}

export interface LogEvent {
  // Required fields
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;
  
  // Contextual fields
  appId?: string;
  agentId?: string;
  userId?: string;
  requestId?: string;
  conversationId?: string;
  
  // Event data
  data?: Record<string, any>;
  
  // Technical fields
  duration?: number;
  error?: LogError;
  
  // Metadata
  tags?: string[];
  meta?: Record<string, any>;
}

export interface LogOptions {
  duration?: number;
  tags?: string[];
  meta?: Record<string, any>;
  error?: LogError | undefined;
}

export interface LogHandler {
  handle(event: LogEvent): void | Promise<void>;
  flush?(): void | Promise<void>;
}

export interface LoggerConfig {
  level: LogLevel;
  handlers: LogHandler[];
  context?: LogContext;
  enabledDomains?: string[];
  disabledDomains?: string[];
  optInDomains?: string[];
}

export interface ILogger {
  debug(event: string, data?: any, options?: LogOptions): void;
  info(event: string, data?: any, options?: LogOptions): void;
  warn(event: string, data?: any, options?: LogOptions): void;
  error(event: string, data?: any, options?: LogOptions): void;
  fatal(event: string, data?: any, options?: LogOptions): void;
  
  log(level: LogLevel, event: string, data?: any, options?: LogOptions): void;
  child(context: LogContext): ILogger;
  withContext(context: LogContext): ILogger;
  
  isEnabled(level: LogLevel): boolean;
  isDomainEnabled(event: string): boolean;
}
