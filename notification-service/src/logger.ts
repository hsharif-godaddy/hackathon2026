type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const configuredLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
const minRank = LEVEL_RANK[configuredLevel] ?? LEVEL_RANK.info;

function log(level: Level, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < minRank) return;
  const entry = data ? { message, ...data } : { message };
  const output = JSON.stringify(entry);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),
  info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
  warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
  error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
};
