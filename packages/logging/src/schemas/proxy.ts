import type pino from 'pino';

/**
 * Proxy schema profile.
 *
 * Production JSON:
 * {level(UPPERCASE), time(ISO), pid, hostname, msg,
 *  request{id,method,path}, response{statusCode}, duration}
 */
export function proxyFormatters(): pino.LoggerOptions['formatters'] {
  return {
    level(label: string) {
      return { level: label.toUpperCase() };
    },
    log(obj: Record<string, unknown>) {
      return obj;
    },
  };
}

/** pino-http options for proxy service */
export function proxyHttpOptions() {
  return {
    customLogLevel: (_req: unknown, res: { statusCode: number }, err?: Error) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req: { url?: string }) => {
        const url = req.url || '';
        return url.startsWith('/health') || url.startsWith('/metrics') || url.startsWith('/img/search');
      },
    },
    customAttributeKeys: {
      req: 'request',
      res: 'response',
      err: 'error',
      responseTime: 'duration',
    },
    serializers: {
      req: (req: { id?: string; method?: string; url?: string }) => ({
        id: req.id,
        method: req.method,
        path: req.url,
      }),
      res: (res: { statusCode?: number }) => ({
        statusCode: res.statusCode,
      }),
    },
  };
}
