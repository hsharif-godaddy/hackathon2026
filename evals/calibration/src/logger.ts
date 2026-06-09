type Level = 'silent' | 'info' | 'debug';

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeJson(data: Record<string, unknown> | undefined): string {
  if (!data || !Object.keys(data).length) return '';
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ' [unserializable]';
  }
}

export function createLogger(params: { level: Level; scope?: string }): Logger {
  const scopePrefix = params.scope ? `[${params.scope}] ` : '';

  const log = function log(method: 'log' | 'error', message: string, data?: Record<string, unknown>) {
    // Intentionally avoid logging secrets. Callers must only pass safe fields.
    // Timestamp first so logs sort chronologically even when buffered.
    // eslint-disable-next-line no-console
    console[method](`${nowIso()} ${scopePrefix}${message}${safeJson(data)}`);
  };

  return {
    info(message, data) {
      if (params.level === 'silent') return;
      log('log', message, data);
    },
    debug(message, data) {
      if (params.level !== 'debug') return;
      log('log', message, data);
    },
    error(message, data) {
      log('error', message, data);
    },
  };
}

