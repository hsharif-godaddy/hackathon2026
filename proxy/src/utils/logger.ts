import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { config } from '../config';
import { LogMeta } from '../types';

/**
 * Configure pino logger with appropriate settings based on environment
 */
const pinoLogger = pino({
  level: config.logging.level,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(config.logging.format === 'text' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  })
});

/**
 * Wrapper around pino logger to match our previous API signature
 */
const logger = {
  error: (message: string, meta: LogMeta = {}) => pinoLogger.error(meta, message),
  warn: (message: string, meta: LogMeta = {}) => pinoLogger.warn(meta, message),
  info: (message: string, meta: LogMeta = {}) => pinoLogger.info(meta, message),
  debug: (message: string, meta: LogMeta = {}) => pinoLogger.debug(meta, message),

  /**
   * Create express middleware for request logging
   *
   * @returns Express middleware function for HTTP request logging
   */
  middleware: () => {
    return pinoHttp({
      logger: pinoLogger,
      genReqId: () => Math.random().toString(36).substring(7),
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) {
          return 'error';
        } else if (res.statusCode >= 400) {
          return 'warn';
        }
        return 'info';
      },
      autoLogging: {
        ignore: (req) => {
          // Skip logging for health checks and Getty search (Getty has its own detailed logs)
          return Boolean(req.url?.startsWith('/health') ?? req.url?.startsWith('/metrics') ?? req.url?.startsWith('/img/search'));
        }
      },
      customErrorMessage: (_req, _res, err) => {
        return `Request failed: ${err.message}`;
      },
      customAttributeKeys: {
        req: 'request',
        res: 'response',
        err: 'error',
        responseTime: 'duration'
      },
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          path: req.url
        }),
        res: (res) => ({
          statusCode: res.statusCode
        })
      }
    });
  }
};

export default logger;
