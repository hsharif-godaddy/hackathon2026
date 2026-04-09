import { Writable } from 'node:stream';

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  purple: '\x1b[95m',
};

const colorize = process.stdout.isTTY === true;

function c(color: keyof typeof COLORS, text: string): string {
  return colorize ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

const LEVEL_DISPLAY: Record<string, string> = {
  debug: colorize ? `${COLORS.gray}DEBUG${COLORS.reset}` : 'DEBUG',
  info: colorize ? `${COLORS.blue}INFO ${COLORS.reset}` : 'INFO ',
  warn: colorize ? `${COLORS.yellow}WARN ${COLORS.reset}` : 'WARN ',
  error: colorize ? `${COLORS.red}ERROR${COLORS.reset}` : 'ERROR',
  fatal: colorize ? `${COLORS.red}FATAL${COLORS.reset}` : 'FATAL',
};

const DOMAIN_ICONS: Record<string, string> = {
  app: '📱', agent: '🤖', file: '📄', api: '🌐', db: '💾',
  ws: '🔌', perf: '⚡', jwks: '🔑', jwt: '🔑', cert: '🔑',
  http: '🌐', websocket: '🔌', llm: '🧠', tool: '⚒️', memory: '📊',
};

function getDomainIcon(event: string): string {
  const domain = event.split('.')[0] || '';
  return DOMAIN_ICONS[domain] || '';
}

function formatTimestamp(ts: string): string {
  try {
    return c('gray', `[${new Date(ts).toLocaleTimeString()}]`);
  } catch {
    return c('gray', `[${ts}]`);
  }
}

function formatContext(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  if (obj.appId || obj.app_id) {
    const id = String(obj.appId || obj.app_id);
    parts.push(`app:${id.substring(0, 8)}`);
  }
  if (obj.agentId) parts.push(`agent:${obj.agentId}`);
  if (obj.requestId) parts.push(`req:${obj.requestId}`);
  if (obj.conversationId) {
    parts.push(`conv:${String(obj.conversationId).substring(0, 8)}`);
  }
  return parts.length > 0 ? c('gray', `[${parts.join('|')}]`) : '';
}

function formatData(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return '';

  // Compact format for small objects
  if (keys.length <= 4 && keys.every(k => {
    const v = obj[k];
    return typeof v === 'string' ? (v as string).length < 50 : (typeof v === 'number' || typeof v === 'boolean');
  })) {
    const parts = keys.map(k => {
      const v = obj[k];
      if (typeof v === 'string') return `${c('cyan', k)}:"${c('green', v)}"`;
      if (typeof v === 'number') return `${c('cyan', k)}:${c('yellow', String(v))}`;
      if (typeof v === 'boolean') return `${c('cyan', k)}:${v ? c('green', 'true') : c('red', 'false')}`;
      return `${k}:${v}`;
    });
    return `  {${parts.join(', ')}}`;
  }

  // JSON for larger objects
  const json = JSON.stringify(obj, null, 2);
  if (json.length <= 1000) {
    return json.split('\n').map(line => '  ' + line).join('\n');
  }

  const preview = keys.slice(0, 5).join(', ');
  const more = keys.length > 5 ? ` (+${keys.length - 5} more)` : '';
  return `  ${c('gray', 'Object')} {${preview}${more}}`;
}

function formatError(error: Record<string, unknown>): string {
  if (!error) return '';
  const lines = [c('red', `  ${error.name}: ${error.message}`)];
  if (error.code) lines.push(c('gray', `     Code: ${error.code}`));
  if (error.stack && typeof error.stack === 'string') {
    lines.push(c('gray', '     Stack:'));
    const stackLines = error.stack.split('\n').slice(1, 6);
    for (const line of stackLines) {
      lines.push(`       ${c('gray', line.trim())}`);
    }
  }
  return lines.join('\n');
}

function formatHttpRequest(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  if (obj.time) parts.push(formatTimestamp(String(obj.time)));

  const isError = String(obj.event || '').includes('.error');
  parts.push(isError ? c('red', '🌐') : c('blue', '🌐'));

  const data = (obj.data || {}) as Record<string, unknown>;
  const method = String(data.method || 'GET');
  const url = String(data.url || '/');
  const stats = (data.responseStats || {}) as Record<string, unknown>;

  parts.push(c(method === 'GET' ? 'green' : method === 'POST' ? 'blue' : method === 'DELETE' ? 'red' : 'yellow', method));
  parts.push(c('cyan', url));

  if (stats.statusCode !== undefined) {
    const code = Number(stats.statusCode);
    const color = code < 300 ? 'green' : code < 400 ? 'yellow' : 'red';
    parts.push(`- ${c(color, String(code))}`);
  }
  if (stats.duration !== undefined) parts.push(c('gray', `(${stats.duration}ms)`));
  if (data.requestId) parts.push(c('gray', `[req:${data.requestId}]`));

  return parts.join(' ');
}

function formatLlmEvent(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  if (obj.time) parts.push(formatTimestamp(String(obj.time)));

  const isError = String(obj.event || '').includes('.error');
  parts.push(isError ? c('red', '🧠') : c('magenta', '🧠'));

  const data = (obj.data || {}) as Record<string, unknown>;
  const event = String(obj.event || '');

  if (event === 'llm.request') {
    parts.push(c('blue', 'REQUEST'));
    if (data.model) parts.push(c('cyan', String(data.model).replace('claude-', '')));
    if (data.messageCount) parts.push(`${data.messageCount}msg`);
    const caps: string[] = [];
    if (data.hasTools) caps.push('tools');
    if (data.streaming) caps.push('stream');
    if (caps.length > 0) parts.push(c('yellow', `[${caps.join('+')}]`));
  } else if (event === 'llm.response') {
    parts.push(c('green', 'RESPONSE'));
    if (data.model) parts.push(c('cyan', String(data.model).replace('claude-', '')));
    if (data.contentLength) parts.push(`${data.contentLength}chars`);
    if (data.duration) parts.push(c('gray', `(${Math.round(Number(data.duration))}ms)`));
    const usage = data.usage as Record<string, unknown> | undefined;
    if (usage?.totalTokens) parts.push(c('yellow', `${usage.totalTokens}tok`));
  } else {
    parts.push(c('red', 'ERROR'));
    if (data.model) parts.push(c('cyan', String(data.model).replace('claude-', '')));
    if (obj.error) parts.push(c('red', `- ${(obj.error as Record<string, unknown>).message}`));
  }

  if (data.agentId) parts.push(`agent:${c('cyan', String(data.agentId))}`);
  return parts.join(' ');
}

function formatGenericEvent(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  const time = obj.time as string | undefined;
  if (time) parts.push(formatTimestamp(time));

  const level = String(obj.level || 'info').toLowerCase();
  parts.push(LEVEL_DISPLAY[level] || level.toUpperCase());

  const event = String(obj.event || 'unknown');
  const icon = getDomainIcon(event);
  if (icon) parts.push(icon);
  parts.push(event);

  // Message (skip if it's just the event name echoed back)
  const message = String(obj.message || '');
  if (message && message !== event) {
    parts.push(message);
  }

  if (obj.duration) parts.push(c('gray', `(${obj.duration}ms)`));

  const ctx = formatContext(obj);
  if (ctx) parts.push(ctx);

  let output = parts.join(' ');

  if (obj.data) {
    const dataStr = formatData(obj.data);
    if (dataStr) output += '\n' + dataStr;
  }

  if (obj.error) {
    output += '\n' + formatError(obj.error as Record<string, unknown>);
  }

  if (obj.tags && Array.isArray(obj.tags) && obj.tags.length > 0) {
    output += '\n' + c('gray', `Tags: ${obj.tags.join(', ')}`);
  }

  return output;
}

/**
 * Create a synchronous Pino destination for rich dev output.
 */
export function devTransport(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      try {
        const obj = JSON.parse(chunk.toString()) as Record<string, unknown>;
        const event = String(obj.event || '');

        let formatted: string;
        if (event.startsWith('http.request.')) {
          formatted = formatHttpRequest(obj);
        } else if (event.startsWith('llm.')) {
          formatted = formatLlmEvent(obj);
        } else {
          formatted = formatGenericEvent(obj);
        }

        // Route to stderr for errors
        const level = String(obj.level || '').toLowerCase();
        if (level === 'error' || level === 'fatal') {
          process.stderr.write(formatted + '\n');
        } else {
          process.stdout.write(formatted + '\n');
        }
      } catch {
        // Fallback: write raw
        process.stdout.write(chunk);
      }
      callback();
    },
  });
}
