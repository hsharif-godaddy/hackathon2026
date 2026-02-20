/**
 * Main logging system exports
 */

// Core logger and types
export { Logger, logger, createTimer, generateRequestId, toPinoLogger } from './Logger.js';
export type { 
  ILogger, 
  LogLevel, 
  LogEvent, 
  LogContext, 
  LogOptions, 
  LoggerConfig, 
  LogHandler,
  LogError
} from './types.js';

// Configuration
export { 
  createConfigFromEnvironment, 
  LoggingPresets, 
  isValidLogLevel, 
  parseDomainList, 
  getConfigSummary 
} from './config.js';
export type { LoggingEnvironmentConfig } from './config.js';

// Schemas and validation
export { 
  validateLogEvent, 
  errorToLogError, 
  sanitizeLogEvent 
} from './schemas/index.js';
export type {
  AppEvent,
  AgentEvent,
  FileEvent,
  APIEvent,
  DatabaseEvent,
  WebSocketEvent,
  PerformanceEvent
} from './schemas/events.js';

// Handlers
export { ProductionHandler } from './handlers/ProductionHandler.js';
export { DevelopmentHandler } from './handlers/DevelopmentHandler.js';
export { TestHandler } from './handlers/TestHandler.js';

// Import utility functions
import * as logUtils from './utils.js';

// Convenience exports for common patterns
export const log = {
  forApp: logUtils.forApp,
  forAgent: logUtils.forAgent,
  forRequest: logUtils.forRequest,
  forConversation: logUtils.forConversation,
  forAppAndAgent: logUtils.forAppAndAgent,
  withContext: logUtils.withContext,
  timer: logUtils.timer,
  error: logUtils.error,
  withRequest: logUtils.withRequest,
};

// Note: Main types are already exported above, no need to re-export