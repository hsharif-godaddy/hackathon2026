import type { LogLevel, LoggerConfig, LogHandler } from './types.js';
import { ProductionHandler } from './handlers/ProductionHandler.js';
import { DevelopmentHandler } from './handlers/DevelopmentHandler.js';
import { TestHandler } from './handlers/TestHandler.js';

/**
 * Configuration utilities for the logging system
 */

export interface LoggingEnvironmentConfig {
  level: LogLevel;
  format: 'json' | 'pretty' | 'dev';
  domains?: string[];
  disabledDomains?: string[];
  optInDomains?: string[];

  // Development options
  expandThreshold?: number;
  showTimestamps?: boolean;
  showDuration?: boolean;
  colorize?: boolean;

  // Production options
  outputStream?: NodeJS.WriteStream;
  errorStream?: NodeJS.WriteStream;

  // Test options
  maxEvents?: number;
}

/**
 * Create logger configuration from environment variables
 */
export function createConfigFromEnvironment(): LoggerConfig {
  const config: LoggingEnvironmentConfig = {
    level: (process.env.LOG_LEVEL as LogLevel) || getDefaultLogLevel(),
    format: (process.env.LOG_FORMAT as any) || getDefaultFormat(),

    // Development options
    expandThreshold: process.env.LOG_DEV_EXPAND_THRESHOLD
      ? parseInt(process.env.LOG_DEV_EXPAND_THRESHOLD)
      : 1000,
    showTimestamps: process.env.LOG_DEV_TIMESTAMPS !== 'false',
    showDuration: process.env.LOG_DEV_PERFORMANCE !== 'false',
    colorize: process.env.LOG_DEV_COLORIZE !== 'false' && process.stdout.isTTY,

    // Test options
    maxEvents: process.env.LOG_TEST_MAX_EVENTS
      ? parseInt(process.env.LOG_TEST_MAX_EVENTS)
      : 1000,
  };

  // Parse domains from environment
  if (process.env.LOG_DOMAINS) {
    config.domains = process.env.LOG_DOMAINS.split(',').map(d => d.trim());
  }

  if (process.env.LOG_DISABLED_DOMAINS) {
    config.disabledDomains = process.env.LOG_DISABLED_DOMAINS.split(',').map(d => d.trim());
  }

  if (process.env.LOG_OPT_IN_DOMAINS) {
    config.optInDomains = process.env.LOG_OPT_IN_DOMAINS.split(',').map(d => d.trim());
  } else {
    // Default opt-in domains (noisy debug logging)
    config.optInDomains = [
      'compression.file_edit',
      'compression.file_edit_input',
      'compression.message',
      'file-cleanup.run',
      'memory.hook',
    ];
  }

  const loggerConfig: LoggerConfig = {
    level: config.level,
    handlers: createHandlers(config),
    context: {
      service: 'airo-agents',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      appId: process.env.SITE_ID || '',
      // ECS standard fields for container metadata
      'container.image.tag': process.env.AGENT_IMAGE_TAG || 'unknown',
      'service.version': process.env.AGENT_IMAGE_TAG || 'unknown',
      'service.name': 'airo-agent',
    },
  };

  if (config.domains) {
    loggerConfig.enabledDomains = config.domains;
  }

  if (config.disabledDomains) {
    loggerConfig.disabledDomains = config.disabledDomains;
  }

  if (config.optInDomains) {
    loggerConfig.optInDomains = config.optInDomains;
  }

  return loggerConfig;
}

/**
 * Create appropriate handlers based on configuration
 */
function createHandlers(config: LoggingEnvironmentConfig): LogHandler[] {
  const handlers: LogHandler[] = [];

  switch (config.format) {
    case 'json': {
      const productionOptions: { output?: NodeJS.WriteStream; errorOutput?: NodeJS.WriteStream } = {};
      if (config.outputStream) productionOptions.output = config.outputStream;
      if (config.errorStream) productionOptions.errorOutput = config.errorStream;
      handlers.push(new ProductionHandler(productionOptions));
      break;
    }

    case 'dev':
    case 'pretty': {
      const devOptions: {
        expandThreshold?: number;
        showTimestamps?: boolean;
        showDuration?: boolean;
        colorize?: boolean
      } = {};
      if (config.expandThreshold !== undefined) devOptions.expandThreshold = config.expandThreshold;
      if (config.showTimestamps !== undefined) devOptions.showTimestamps = config.showTimestamps;
      if (config.showDuration !== undefined) devOptions.showDuration = config.showDuration;
      if (config.colorize !== undefined) devOptions.colorize = config.colorize;
      handlers.push(new DevelopmentHandler(devOptions));
      break;
    }

    default:
      // Auto-detect based on environment
      if (process.env.NODE_ENV === 'production') {
        const prodOptions: { output?: NodeJS.WriteStream; errorOutput?: NodeJS.WriteStream } = {};
        if (config.outputStream) prodOptions.output = config.outputStream;
        if (config.errorStream) prodOptions.errorOutput = config.errorStream;
        handlers.push(new ProductionHandler(prodOptions));
      } else if (process.env.NODE_ENV === 'test') {
        const testOptions: { maxEvents?: number } = {};
        if (config.maxEvents !== undefined) testOptions.maxEvents = config.maxEvents;
        handlers.push(new TestHandler(testOptions));
      } else {
        const devOptions: {
          expandThreshold?: number;
          showTimestamps?: boolean;
          showDuration?: boolean;
          colorize?: boolean
        } = {};
        if (config.expandThreshold !== undefined) devOptions.expandThreshold = config.expandThreshold;
        if (config.showTimestamps !== undefined) devOptions.showTimestamps = config.showTimestamps;
        if (config.showDuration !== undefined) devOptions.showDuration = config.showDuration;
        if (config.colorize !== undefined) devOptions.colorize = config.colorize;
        handlers.push(new DevelopmentHandler(devOptions));
      }
  }

  return handlers;
}

/**
 * Get default log level based on environment
 */
function getDefaultLogLevel(): LogLevel {
  switch (process.env.NODE_ENV) {
    case 'production':
      return 'info';
    case 'test':
      return 'warn';
    case 'development':
    default:
      return 'debug';
  }
}

/**
 * Get default format based on environment
 */
function getDefaultFormat(): 'json' | 'pretty' | 'dev' {
  switch (process.env.NODE_ENV) {
    case 'production':
      return 'json';
    case 'test':
      return 'dev'; // TestHandler will be used anyway
    case 'development':
    default:
      return 'dev';
  }
}

/**
 * Create configuration for specific use cases
 */
export const LoggingPresets = {
  /**
   * Production configuration with JSON output
   */
  production(): LoggerConfig {
    return {
      level: 'info',
      handlers: [new ProductionHandler()],
      context: {
        service: 'airo-agents',
        version: process.env.npm_package_version || '1.0.0',
        environment: 'production',
      },
    };
  },

  /**
   * Development configuration with rich console output
   */
  development(): LoggerConfig {
    return {
      level: 'debug',
      handlers: [new DevelopmentHandler({
        expandThreshold: 1000,
        showTimestamps: true,
        showDuration: true,
        colorize: true,
      })],
      context: {
        service: 'airo-agents',
        version: process.env.npm_package_version || '1.0.0',
        environment: 'development',
      },
    };
  },

  /**
   * Test configuration with memory buffer
   */
  test(): LoggerConfig {
    return {
      level: 'debug',
      handlers: [new TestHandler({ maxEvents: 1000 })],
      context: {
        service: 'airo-agents',
        version: process.env.npm_package_version || '1.0.0',
        environment: 'test',
      },
    };
  },

  /**
   * Silent configuration (no output)
   */
  silent(): LoggerConfig {
    return {
      level: 'fatal',
      handlers: [],
      context: {
        service: 'airo-agents',
        version: process.env.npm_package_version || '1.0.0',
        environment: 'silent',
      },
    };
  },

  /**
   * Debug configuration with verbose output
   */
  debug(): LoggerConfig {
    return {
      level: 'debug',
      handlers: [new DevelopmentHandler({
        expandThreshold: 5000,
        showTimestamps: true,
        showDuration: true,
        colorize: true,
      })],
      context: {
        service: 'airo-agents',
        version: process.env.npm_package_version || '1.0.0',
        environment: 'debug',
      },
    };
  },
};

/**
 * Validate log level string
 */
export function isValidLogLevel(level: string): level is LogLevel {
  return ['debug', 'info', 'warn', 'error', 'fatal'].includes(level);
}

/**
 * Parse comma-separated domain list
 */
export function parseDomainList(domains: string): string[] {
  return domains
    .split(',')
    .map(d => d.trim())
    .filter(d => d.length > 0);
}

/**
 * Get logging configuration summary for diagnostics
 */
export function getConfigSummary(config: LoggerConfig): string {
  const handlerTypes = config.handlers.map(h => h.constructor.name).join(', ');
  const domains = config.enabledDomains
    ? `enabled: [${config.enabledDomains.join(', ')}]`
    : 'all enabled';
  const disabled = config.disabledDomains?.length
    ? ` disabled: [${config.disabledDomains.join(', ')}]`
    : '';
  const optIn = config.optInDomains?.length
    ? ` opt-in: [${config.optInDomains.join(', ')}]`
    : '';

  return [
    `Level: ${config.level}`,
    `Handlers: ${handlerTypes}`,
    `Domains: ${domains}${disabled}${optIn}`,
    `Context: ${Object.keys(config.context || {}).join(', ')}`,
  ].join(' | ');
}
