import type pino from 'pino';
import { sanitizeSensitiveData } from '../sanitize/index.js';

/**
 * Recursively transform appId -> app_id in all objects
 */
function transformFieldNames(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(transformFieldNames);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newKey = key === 'appId' ? 'app_id' : key;
    result[newKey] = (value && typeof value === 'object') ? transformFieldNames(value) : value;
  }
  return result;
}

/**
 * Agents schema profile.
 *
 * Production JSON:
 * {timestamp, level(lowercase), event, message, app_id, request_id,
 *  component, version, environment, container.image.tag, service.version,
 *  service.name, data, duration, error, tags, meta}
 */
export function agentsFormatters(): pino.LoggerOptions['formatters'] {
  return {
    level(label: string) {
      return { level: label };
    },
    log(obj: Record<string, unknown>) {
      // Sanitize data and meta
      if (obj.data && typeof obj.data === 'object') {
        obj.data = sanitizeSensitiveData(obj.data as Record<string, unknown>);
      }
      if (obj.meta && typeof obj.meta === 'object') {
        obj.meta = sanitizeSensitiveData(obj.meta as Record<string, unknown>);
      }
      // Transform appId -> app_id recursively
      return transformFieldNames(obj) as Record<string, unknown>;
    },
  };
}

/** Default context fields for agents service */
export function agentsContext(): Record<string, unknown> {
  return {
    component: 'airo-agents',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    appId: process.env.SITE_ID || '',
    'container.image.tag': process.env.AGENT_IMAGE_TAG || 'unknown',
    'service.version': process.env.AGENT_IMAGE_TAG || 'unknown',
    'service.name': 'airo-agent',
  };
}
