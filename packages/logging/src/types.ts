export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  appId?: string;
  agentId?: string;
  userId?: string;
  requestId?: string;
  conversationId?: string;
  customerId?: string;
  component?: string;
  version?: string;
  [key: string]: unknown;
}

export interface LogError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
}

export interface LogEvent {
  /** Pino emits `time` via isoTime; client logger emits `timestamp` */
  time?: string;
  timestamp?: string;
  level: LogLevel;
  event: string;
  message: string;

  // Context fields (spread at top level)
  appId?: string;
  agentId?: string;
  userId?: string;
  requestId?: string;
  conversationId?: string;
  customerId?: string;

  // Event data
  data?: Record<string, unknown>;

  // Technical
  duration?: number;
  error?: LogError;

  // Metadata
  tags?: string[];
  meta?: Record<string, unknown>;

  // Allow additional context fields
  [key: string]: unknown;
}

export interface LogOptions {
  duration?: number;
  tags?: string[];
  meta?: Record<string, unknown>;
  error?: LogError;
}

export interface AiroLogger {
  debug(event: string, data?: unknown, options?: LogOptions): void;
  info(event: string, data?: unknown, options?: LogOptions): void;
  warn(event: string, data?: unknown, options?: LogOptions): void;
  error(event: string, data?: unknown, options?: LogOptions): void;
  fatal(event: string, data?: unknown, options?: LogOptions): void;
  child(context: LogContext): AiroLogger;
}

export interface DomainFilterConfig {
  enabledDomains?: string[];
  disabledDomains?: string[];
  optInDomains?: string[];
}

export type SchemaProfile = 'agents' | 'app' | 'proxy';

export interface CreateLoggerOptions {
  schema: SchemaProfile;
  level?: LogLevel;
  context?: LogContext;
  domains?: DomainFilterConfig;
  /** Context provider called at log-time (e.g., APM trace IDs) */
  contextProvider?: () => Record<string, unknown>;
  /** Override output streams (default: stdout/stderr) */
  destination?: NodeJS.WritableStream;
}
