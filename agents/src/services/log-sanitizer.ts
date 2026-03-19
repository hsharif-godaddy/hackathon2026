import type { LogEntry } from './DevSupervisorClient.js';

/**
 * Sanitized log entry safe for customer exposure
 */
export interface SanitizedLogEntry {
  timestamp: string;
  source: 'stdout' | 'stderr';
  message: string;
  level: 'info' | 'warn' | 'error';
}

/**
 * Parsed JSON log structure (from dev-supervisor)
 */
interface ParsedJsonLog {
  time?: string;
  level?: string;
  msg?: string;
  app_id?: string;
  type?: string;
  method?: string;
  path?: string;
  status?: number;
  size?: number;
  duration_ms?: number;
  // Infrastructure fields to exclude
  client_ip?: string;
  src_ip?: string;
  src_port?: string;
  ray_id?: string;
  // Allow other fields
  [key: string]: unknown;
}

/**
 * Configuration options for log sanitization
 */
export interface LogSanitizerOptions {
  /** Additional regex patterns to redact */
  redactPatterns?: RegExp[];
  /** Allowed log levels (default: info, warn, error) */
  allowedLevels?: string[];
  /** Maximum message length (default: 1000) */
  maxMessageLength?: number;
  /** Message types to filter out as noise (default: ['http.request']) */
  noiseMessageTypes?: string[];
}

const DEFAULT_ALLOWED_LEVELS = ['info', 'warn', 'error'];
const DEFAULT_MAX_MESSAGE_LENGTH = 1000;
/** Default noise message types to filter out */
const DEFAULT_NOISE_MESSAGE_TYPES = ['http.request', 'http_request'];

/** Infrastructure fields to exclude from customer logs */
const INFRASTRUCTURE_FIELDS = [
  'client_ip',
  'src_ip',
  'src_port',
  'ray_id',
  'app_id',
  'type',
];

/**
 * Patterns for detecting and redacting sensitive information
 */
const SECRET_PATTERNS: RegExp[] = [
  // API Keys with common prefixes
  /\b(sk-[a-zA-Z0-9]{20,})\b/gi,                                    // OpenAI API keys
  /\b(AKIA[0-9A-Z]{16})\b/gi,                                       // AWS Access Key ID

  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/gi,  // Bearer JWT

  // JWT tokens (standalone)
  /\beyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\b/g,     // JWT pattern

  // Database connection strings
  /(?:mysql|postgresql|postgres|mongodb|redis):\/\/[^\s]+/gi,       // DB URLs with credentials

  // Generic secret patterns (KEY=value, PASSWORD=value, etc.)
  /\b(API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|AUTH)[_A-Z]*\s*=\s*[^\s]+/gi,
  /\b(OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|DB_PASSWORD|DATABASE_URL)\s*=\s*[^\s]+/gi,

  // Generic long alphanumeric strings that look like secrets (after = sign)
  /=\s*['"]?[a-zA-Z0-9\-_]{32,}['"]?/g,
];

/**
 * Patterns for internal paths and URLs to redact
 */
const INTERNAL_PATTERNS: RegExp[] = [
  // Internal file paths
  /\/home\/[a-zA-Z0-9_-]+\/[^\s]+/g,              // /home/user/anything
  /\/app\/node_modules\/[^\s]+/g,
  /\/tmp\/apps\/[a-zA-Z0-9_-]+/g,

  // Node.js internal paths
  /node:internal\/[^\s]+/g,

  // Stack trace lines (at filepath:line:col)
  /^\s*at\s+.+\([^)]+\)\s*$/gm,
  /^\s*at\s+[^\s]+\s+\([^)]+\)\s*$/gm,

  // Internal service URLs
  /https?:\/\/[a-zA-Z0-9\-_.]+\.(local|internal|airo\.local)(:\d+)?[^\s]*/gi,
];

/** Internal type for log entry with cached parsed JSON */
interface LogEntryWithParsed {
  log: LogEntry;
  parsed: ParsedJsonLog | null;
}

/**
 * Service to sanitize logs before exposing to customers
 *
 * Performs three main operations:
 * 1. Filter by log level (exclude DEBUG)
 * 2. Redact secrets and sensitive data
 * 3. Sanitize error messages (remove internal paths/stack traces)
 */
export class LogSanitizer {
  private options: Required<LogSanitizerOptions>;

  constructor(options: LogSanitizerOptions = {}) {
    this.options = {
      redactPatterns: options.redactPatterns || [],
      allowedLevels: options.allowedLevels || DEFAULT_ALLOWED_LEVELS,
      maxMessageLength: options.maxMessageLength || DEFAULT_MAX_MESSAGE_LENGTH,
      noiseMessageTypes: options.noiseMessageTypes || DEFAULT_NOISE_MESSAGE_TYPES,
    };
  }

  /**
   * Full sanitization pipeline: parse JSON once → filter level → filter noise → sanitize
   */
  sanitizeLogs(logs: LogEntry[]): SanitizedLogEntry[] {
    if (!logs || logs.length === 0) {
      return [];
    }

    return logs
      // Parse JSON once upfront and carry through pipeline
      .map(log => ({ log, parsed: this.tryParseJson(log.message ?? '') }))
      .filter(({ log, parsed }) => (this.isAllowedLevel(parsed?.level || log.level)))
      .filter(({ parsed }) => !this.isNoiseLog(parsed))
      .map(({ log, parsed }) => this.sanitizeEntry(log, parsed))
      .filter((entry): entry is SanitizedLogEntry => entry !== null);
  }

  /**
   * Check if a log entry is noise using pre-parsed JSON
   */
  private isNoiseLog(parsed: ParsedJsonLog | null): boolean {
    if (parsed) {
      const msgType = parsed.msg || parsed.type || '';
      return this.options.noiseMessageTypes.includes(msgType);
    }
    return false;
  }

  /**
   * Check if a log level is allowed
   */
  private isAllowedLevel(level: string | undefined): boolean {
    // If no level, default to allowing (treat as info)
    if (!level) return true;

    const normalizedLevel = level.toLowerCase();
    return this.options.allowedLevels.includes(normalizedLevel);
  }

  /**
   * Try to parse a message as JSON
   */
  tryParseJson(message: string): ParsedJsonLog | null {
    if (!message || !message.trim().startsWith('{')) {
      return null;
    }

    try {
      return JSON.parse(message) as ParsedJsonLog;
    } catch {
      return null;
    }
  }

  /**
   * Format a parsed JSON log into a customer-friendly message
   */
  formatJsonLog(parsed: ParsedJsonLog): string {
    // Remove infrastructure fields
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!INFRASTRUCTURE_FIELDS.includes(key) && value !== undefined) {
        cleaned[key] = value;
      }
    }

    // Build a human-readable message based on log type
    const msg = parsed.msg || '';
    const level = parsed.level || 'INFO';

    // For build/deployment logs, format nicely
    if (msg && msg !== 'http.request' && msg !== 'http_request') {
      // Include relevant fields in the message
      const parts: string[] = [`[${level}] ${msg}`];

      // Add path for relevant logs
      if (parsed.path && !msg.includes(parsed.path)) {
        parts.push(`path: ${parsed.path}`);
      }

      // Add status for response logs
      if (parsed.status !== undefined) {
        parts.push(`status: ${parsed.status}`);
      }

      // Add duration for performance-relevant logs
      if (parsed.duration_ms !== undefined) {
        parts.push(`duration: ${parsed.duration_ms}ms`);
      }

      return parts.join(' | ');
    }

    // Fallback: return cleaned JSON
    return JSON.stringify(cleaned);
  }

  /**
   * Filter logs by allowed levels
   */
  filterByLevel(logs: LogEntry[]): LogEntry[] {
    return logs.filter(log => this.isAllowedLevel(log.level));
  }

  /**
   * Redact secrets from a message
   */
  redactSecrets(message: string): string {
    if (!message) return '';

    let result = message;

    // Apply built-in secret patterns
    for (const pattern of SECRET_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }

    // Apply custom patterns
    for (const pattern of this.options.redactPatterns) {
      result = result.replace(pattern, '[REDACTED]');
    }

    return result;
  }

  /**
   * Sanitize error messages by removing internal details
   */
  sanitizeErrorMessages(message: string): string {
    if (!message) return '';

    let result = message;

    // Remove stack trace lines
    result = result.replace(/^\s*at\s+.+$/gm, '');

    // Remove internal paths
    for (const pattern of INTERNAL_PATTERNS) {
      result = result.replace(pattern, '[internal]');
    }

    // Clean up multiple newlines left by removed stack traces
    result = result.replace(/\n{3,}/g, '\n\n');

    // Trim and truncate
    result = result.trim();
    if (result.length > this.options.maxMessageLength) {
      result = result.substring(0, this.options.maxMessageLength - 3) + '...';
    }

    return result;
  }

  /**
   * Sanitize a single log entry with pre-parsed JSON
   */
  private sanitizeEntry(log: LogEntry, parsedJson: ParsedJsonLog | null): SanitizedLogEntry | null {
    try {
      const message = log.message ?? '';
      let sanitizedMessage: string;
      let timestamp = log.timestamp;
      let level = log.level;

      if (parsedJson) {
        // JSON log - format it nicely and extract metadata
        sanitizedMessage = this.formatJsonLog(parsedJson);

        // Use timestamp from JSON if available
        if (parsedJson.time) {
          timestamp = parsedJson.time;
        }

        // Use level from JSON if available
        if (parsedJson.level) {
          level = parsedJson.level;
        }
      } else {
        // Plain text log - apply standard sanitization
        sanitizedMessage = message;
      }

      // Apply sanitization pipeline to the message
      sanitizedMessage = this.redactSecrets(sanitizedMessage);
      sanitizedMessage = this.sanitizeErrorMessages(sanitizedMessage);

      // Skip empty messages after sanitization
      if (!sanitizedMessage.trim()) {
        return null;
      }

      // Normalize level
      const normalizedLevel = this.normalizeLevel(level);

      // Normalize source
      const source = this.normalizeSource(log.source);

      return {
        timestamp: timestamp || new Date().toISOString(),
        source,
        message: sanitizedMessage,
        level: normalizedLevel,
      };
    } catch {
      // If sanitization fails, skip this entry
      return null;
    }
  }

  /**
   * Normalize log level to standard format
   */
  private normalizeLevel(level: string | undefined): 'info' | 'warn' | 'error' {
    if (!level) return 'info';

    const normalized = level.toLowerCase();

    if (normalized === 'warn' || normalized === 'warning') return 'warn';
    if (normalized === 'error' || normalized === 'err') return 'error';

    return 'info';
  }

  /**
   * Normalize source to standard format
   */
  private normalizeSource(source: string): 'stdout' | 'stderr' {
    if (source === 'stderr') return 'stderr';
    return 'stdout';
  }
}
