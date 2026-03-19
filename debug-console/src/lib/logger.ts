type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogOptions {
    error?: Error;
    duration?: number;
    tags?: string[];
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

function getDefaultLevel(): LogLevel {
    if (isBrowser()) return 'debug';
    const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
    if (envLevel && LOG_LEVELS.includes(envLevel)) return envLevel;
    return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
}

function isEnabled(level: LogLevel, threshold: LogLevel): boolean {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);
}

function formatMessage(event: string, data?: unknown): string {
    if (!data) return event;
    if (typeof data === 'string') return `${event}: ${data}`;
    if (typeof data === 'object' && data !== null && 'message' in data) {
        return `${event}: ${(data as { message: string }).message}`;
    }
    return event;
}

function consoleMethod(level: LogLevel) {
    if (level === 'error' || level === 'fatal') return console.error;
    if (level === 'warn') return console.warn;
    if (level === 'debug') return console.debug;
    return console.info;
}

/**
 * Browser: CSS-styled console output with expandable data objects
 */
function browserOutput(level: LogLevel, event: string, data?: Record<string, unknown>, options?: LogOptions): void {
    const colors: Record<LogLevel, string> = {
        debug: 'color: #888',
        info: 'color: #2e7d32',
        warn: 'color: #f57c00',
        error: 'color: #d32f2f',
        fatal: 'color: #9c27b0',
    };

    const levelStr = level.toUpperCase().padEnd(5);
    const msg = formatMessage(event, data);
    const log = consoleMethod(level);

    if (data && Object.keys(data).length > 0) {
        log(`%c${levelStr}%c ${msg}`, colors[level], 'color: inherit', data);
    } else {
        log(`%c${levelStr}%c ${msg}`, colors[level], 'color: inherit');
    }

    if (options?.error?.message) {
        console.error(`  → ${options.error.message}`);
    }
}

/**
 * Server dev: ANSI-colored compact output for terminal readability
 */
function serverDevOutput(level: LogLevel, event: string, data?: Record<string, unknown>, options?: LogOptions): void {
    const c = {
        debug: '\x1b[90m',
        info: '\x1b[32m',
        warn: '\x1b[33m',
        error: '\x1b[31m',
        fatal: '\x1b[35m',
        reset: '\x1b[0m',
        dim: '\x1b[90m',
    };

    const color = c[level] || c.reset;
    const levelStr = level.toUpperCase().padEnd(5);
    const msg = formatMessage(event, data);

    const fields: string[] = [];
    if (data && typeof data === 'object') {
        for (const [key, val] of Object.entries(data)) {
            if (key === 'message' || val === undefined || val === null || val === '') continue;
            const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
            fields.push(`${c.dim}${key}=${c.reset}${display.length > 80 ? display.slice(0, 77) + '...' : display}`);
        }
    }

    console.log(`${color}${levelStr}${c.reset} ${msg}`);

    if (fields.length > 0) {
        console.log(`      ${fields.slice(0, 5).join('  ')}`);
    }

    if (options?.error?.message) {
        console.log(`      ${c.error}→ ${options.error.message}${c.reset}`);
    }
}

/**
 * Server prod: structured JSON for log aggregation
 */
function serverProdOutput(level: LogLevel, event: string, data?: Record<string, unknown>, options?: LogOptions): void {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        message: formatMessage(event, data),
        ...data,
        ...(options?.error ? { error: { message: options.error.message, stack: options.error.stack, name: options.error.name } } : {}),
        ...(options?.duration !== undefined ? { duration: options.duration } : {}),
        ...(options?.tags ? { tags: options.tags } : {}),
    }));
}

function output(level: LogLevel, event: string, data?: Record<string, unknown>, options?: LogOptions): void {
    if (isBrowser()) {
        browserOutput(level, event, data, options);
        return;
    }

    if (process.env.NODE_ENV === 'development') {
        serverDevOutput(level, event, data, options);
    } else {
        serverProdOutput(level, event, data, options);
    }
}

function log(level: LogLevel, event: string, data?: Record<string, unknown>, options?: LogOptions): void {
    if (!isEnabled(level, getDefaultLevel())) return;
    output(level, event, data, options);
}

export const logger = {
    debug(event: string, data?: Record<string, unknown>, options?: LogOptions): void {
        log('debug', event, data, options);
    },
    info(event: string, data?: Record<string, unknown>, options?: LogOptions): void {
        log('info', event, data, options);
    },
    warn(event: string, data?: Record<string, unknown>, options?: LogOptions): void {
        log('warn', event, data, options);
    },
    error(event: string, data?: Record<string, unknown>, options?: LogOptions): void {
        log('error', event, data, options);
    },
    fatal(event: string, data?: Record<string, unknown>, options?: LogOptions): void {
        log('fatal', event, data, options);
    },
};
