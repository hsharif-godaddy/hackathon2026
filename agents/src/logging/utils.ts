/**
 * Utility functions for logging system
 */
import { Logger, createTimer, generateRequestId } from './Logger.js';
import type { ILogger } from './types.js';
import { errorToLogError } from './schemas/index.js';

/**
 * Create a logger with app context
 */
export function forApp(appId: string): ILogger {
  return Logger.create({ appId });
}

/**
 * Create a logger with agent context
 */
export function forAgent(agentId: string): ILogger {
  return Logger.create({ agentId });
}

/**
 * Create a logger with request context
 */
export function forRequest(requestId: string): ILogger {
  return Logger.create({ requestId });
}

/**
 * Create a logger with conversation context
 */
export function forConversation(conversationId: string): ILogger {
  return Logger.create({ conversationId });
}

/**
 * Create a logger with multiple context values
 * 
 * @param context - Object with any combination of context values (appId, agentId, requestId, etc.)
 * @returns Logger instance with all context values
 * 
 * @example
 * ```typescript
 * const logger = withContext({ appId: '123', agentId: 'develop' });
 * logger.info('event', { data: 'value' }); // appId and agentId will be in all logs
 * ```
 */
export function withContext(context: Record<string, any>): ILogger {
  return Logger.create(context);
}

/**
 * Create a logger with app and agent context
 */
export function forAppAndAgent(appId: string, agentId: string): ILogger {
  return Logger.create({ appId, agentId });
}

/**
 * Create a performance timer with logger
 */
export function timer(logger: ILogger, event: string) {
  const timer = createTimer();
  return {
    end(data?: any) {
      const duration = timer.end();
      logger.info(event, data, { duration });
      return duration;
    }
  };
}

/**
 * Log an error with proper formatting
 */
export function error(logger: ILogger, event: string, error: Error | any, data?: any) {
  logger.error(event, data, {
    error: errorToLogError(error)
  });
}

/**
 * Log with request correlation
 */
export function withRequest(logger: ILogger) {
  const requestId = generateRequestId();
  return {
    logger: logger.withContext({ requestId }),
    requestId
  };
}