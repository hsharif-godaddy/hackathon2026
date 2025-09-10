import { Response, NextFunction } from 'express';
import { config } from '../config';
import { LogLevel, LogMeta, AuthenticatedRequest } from '../types';

class Logger {
  private level: LogLevel;
  private format: 'json' | 'text';
  private levels: Record<LogLevel, number>;

  constructor() {
    this.level = config.logging.level;
    this.format = config.logging.format;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
  }

  private _shouldLog(level: LogLevel): boolean {
    return this.levels[level] <= this.levels[this.level];
  }

  private _formatMessage(level: LogLevel, message: string, meta: LogMeta = {}): string {
    const timestamp = new Date().toISOString();
    
    if (this.format === 'json') {
      return JSON.stringify({
        timestamp,
        level: level.toUpperCase(),
        message,
        ...meta
      });
    } else {
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
    }
  }

  private _log(level: LogLevel, message: string, meta: LogMeta): void {
    if (!this._shouldLog(level)) {
      return;
    }
    
    const formatted = this._formatMessage(level, message, meta);
    
    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  error(message: string, meta: LogMeta = {}): void {
    this._log('error', message, meta);
  }

  warn(message: string, meta: LogMeta = {}): void {
    this._log('warn', message, meta);
  }

  info(message: string, meta: LogMeta = {}): void {
    this._log('info', message, meta);
  }

  debug(message: string, meta: LogMeta = {}): void {
    this._log('debug', message, meta);
  }

  // Express middleware for request logging
  middleware() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      const start = Date.now();
      req.id = Math.random().toString(36).substring(7);
      req.startTime = start;
      
      // Only log completion, not start (to reduce verbosity)
      res.on('finish', () => {
        const duration = Date.now() - start;
        
        // Only log non-health and non-Getty endpoints to reduce noise (Getty endpoints have their own detailed logs)
        if (!req.path.startsWith('/health') && !req.path.startsWith('/metrics') && !req.path.startsWith('/img/search')) {
          this.info('Request completed', {
            requestId: req.id,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            userAgent: req.get('User-Agent'),
            ip: req.ip
          });
        }
      });

      next();
    };
  }
}

export default new Logger();
