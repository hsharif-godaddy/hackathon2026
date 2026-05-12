/**
 * Simple logger for appointment system
 * Respects LOG_LEVEL environment variable and outputs to Grafana Loki
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const currentLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || 'info';
const currentLevelNum = LOG_LEVELS[currentLevel] || LOG_LEVELS.info;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevelNum;
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${dataStr}`;
}

export const logger = {
  debug(message: string, data?: unknown) {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', message, data));
    }
  },

  info(message: string, data?: unknown) {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message, data));
    }
  },

  warn(message: string, data?: unknown) {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, data));
    }
  },

  error(message: string, data?: unknown) {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, data));
    }
  },

  fatal(message: string, data?: unknown) {
    if (shouldLog('fatal')) {
      console.error(formatMessage('fatal', message, data));
    }
  },
};
