import type { LogLevel, DomainFilterConfig } from '../types.js';

const DEFAULT_OPT_IN_DOMAINS = [
  'compression.file_edit',
  'compression.file_edit_input',
  'compression.message',
  'file-cleanup.run',
  'memory.hook',
];

export function getLogLevel(): LogLevel {
  const env = process.env.LOG_LEVEL;
  if (env && isValidLogLevel(env)) return env;

  switch (process.env.NODE_ENV) {
    case 'production': return 'info';
    case 'test': return 'warn';
    default: return 'debug';
  }
}

export function getLogFormat(): 'json' | 'dev' {
  const fmt = process.env.LOG_FORMAT;
  if (fmt === 'json') return 'json';
  if (fmt === 'dev' || fmt === 'pretty') return 'dev';

  return process.env.NODE_ENV === 'production' ? 'json' : 'dev';
}

export function getDomainConfig(): DomainFilterConfig {
  const config: DomainFilterConfig = {};

  if (process.env.LOG_DOMAINS) {
    config.enabledDomains = parseDomainList(process.env.LOG_DOMAINS);
  }

  if (process.env.LOG_DISABLED_DOMAINS) {
    config.disabledDomains = parseDomainList(process.env.LOG_DISABLED_DOMAINS);
  }

  if (process.env.LOG_OPT_IN_DOMAINS) {
    config.optInDomains = parseDomainList(process.env.LOG_OPT_IN_DOMAINS);
  } else {
    config.optInDomains = DEFAULT_OPT_IN_DOMAINS;
  }

  return config;
}

export function isValidLogLevel(level: string): level is LogLevel {
  return ['debug', 'info', 'warn', 'error', 'fatal'].includes(level);
}

export function parseDomainList(domains: string): string[] {
  return domains.split(',').map(d => d.trim()).filter(d => d.length > 0);
}
