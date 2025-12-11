import type { LogEvent } from '../types.js';
import { LogEventSchema } from './base.js';
import { EVENT_SCHEMAS } from './events.js';

/**
 * Main schema validation exports
 */

export * from './base.js';
export * from './events.js';

/**
 * Validate a log event against appropriate schema
 */
export function validateLogEvent(event: LogEvent): LogEvent {
  // First validate against base schema
  const baseResult = LogEventSchema.safeParse(event);
  if (!baseResult.success) {
    throw new Error(`Invalid log event: ${baseResult.error.message}`);
  }

  // Then validate against domain-specific schema if available
  const domain = event.event.split('.')[0] as keyof typeof EVENT_SCHEMAS;
  const domainSchema = EVENT_SCHEMAS[domain];
  
  if (domainSchema) {
    const domainResult = domainSchema.safeParse(event);
    if (!domainResult.success) {
      throw new Error(`Invalid ${domain} event: ${domainResult.error.message}`);
    }
    return domainResult.data as LogEvent;
  }

  return baseResult.data as LogEvent;
}

/**
 * Convert Error object to LogError format
 */
export function errorToLogError(error: Error | any): import('./base.js').LogError | undefined {
  if (!error) return undefined;

  if (error instanceof Error) {
    const result: import('./base.js').LogError = {
      name: error.name,
      message: error.message
    };
    if (error.stack) result.stack = error.stack;
    if ((error as any).code) result.code = (error as any).code;
    return result;
  }

  if (typeof error === 'object' && error.message) {
    const result: import('./base.js').LogError = {
      name: error.name || 'Error',
      message: error.message
    };
    if (error.stack) result.stack = error.stack;
    if (error.code) result.code = error.code;
    return result;
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
}

/**
 * Sanitize sensitive data from log event
 */
export function sanitizeLogEvent(event: LogEvent): LogEvent {
  const sanitized = { ...event };
  
  // Remove or mask sensitive fields
  if (sanitized.data) {
    sanitized.data = sanitizeSensitiveData(sanitized.data);
  }
  
  if (sanitized.meta) {
    sanitized.meta = sanitizeSensitiveData(sanitized.meta);
  }

  return sanitized;
}

/**
 * Sanitize sensitive data from any object
 */
function sanitizeSensitiveData(obj: Record<string, any>): Record<string, any> {
  const sensitiveKeys = [
    'password', 'token', 'secret', 'key', 'apikey', 'api_key',
    'authorization', 'auth', 'credential', 'credentials'
  ];
  
  // Keys that should NOT be redacted even if they contain sensitive keywords
  const allowedKeys = [
    'promptTokens', 'completionTokens', 'totalTokens', 'tokens',
    'tokenCount', 'tokenUsage', 'tokenType', 'inputTokens', 'outputTokens'
  ];
  
  const sanitized = { ...obj };
  
  for (const [key, value] of Object.entries(sanitized)) {
    const lowerKey = key.toLowerCase();
    
    // Skip redaction for allowed token usage fields
    if (allowedKeys.some(allowed => lowerKey === allowed.toLowerCase())) {
      // Still recursively sanitize nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = sanitizeSensitiveData(value);
      }
      continue;
    }
    
    // Check if key is sensitive
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    
    // Recursively sanitize nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeSensitiveData(value);
    }
  }
  
  return sanitized;
}