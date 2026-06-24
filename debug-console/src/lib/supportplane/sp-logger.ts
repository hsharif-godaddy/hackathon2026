// Bitmask log levels — each level is a distinct power of 2.
// Set `activeMask` at runtime to control which levels are recorded.
// E.g. mask=7 enables Fatal(1)+Error(2)+Warn(4); mask=127 enables All.
export const SP_MASK = {
  FATAL:   1,   // 2^0
  ERROR:   2,   // 2^1
  WARN:    4,   // 2^2
  INFO:    8,   // 2^3
  DEBUG:   16,  // 2^4
  TRACE:   32,  // 2^5
  VERBOSE: 64,  // 2^6
  ALL:     127,
} as const;

export type SpMaskKey = keyof typeof SP_MASK;

export interface SpLogEntry {
  id: number;
  ts: number;
  level: number;
  levelName: string;
  source: string;
  message: string;
  context?: Record<string, unknown>;
  exception?: string;
}

export interface SpLogsResult {
  entries: SpLogEntry[];
  total: number;
  facets: Record<string, number>;
}

const RING_SIZE = 3000;
const _ring: SpLogEntry[] = [];
let _seq = 0;
// Default: Fatal + Error + Warn + Info + Debug (mask 31)
let _activeMask = SP_MASK.FATAL | SP_MASK.ERROR | SP_MASK.WARN | SP_MASK.INFO | SP_MASK.DEBUG;

const LEVEL_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(SP_MASK)
    .filter(([k]) => k !== 'ALL')
    .map(([k, v]) => [v as number, k] as [number, string]),
);

function levelName(level: number): string {
  return LEVEL_NAMES.get(level) ?? 'INFO';
}

// Redacts AWS key patterns and credential-style key=value pairs.
const SECRET_RX = /(?:AKIA|ASIA)[0-9A-Z]{16}|(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+/gi;

function redact(text: string): string {
  return text.replace(SECRET_RX, '[REDACTED]');
}

export function spLog(
  level: number,
  source: string,
  message: string,
  context?: Record<string, unknown>,
  error?: Error,
): void {
  if (!(level & _activeMask)) return;

  const entry: SpLogEntry = {
    id: ++_seq,
    ts: Date.now(),
    level,
    levelName: levelName(level),
    source,
    message: redact(message),
    ...(context !== undefined ? { context } : {}),
    ...(error !== undefined ? { exception: `${error.name}: ${redact(error.message)}` } : {}),
  };

  if (_ring.length >= RING_SIZE) _ring.shift();
  _ring.push(entry);
}

export function getLogs(opts: {
  levelMask?: number;
  search?: string;
  since?: number;  // epoch ms — only entries with ts >= since are included
  limit?: number;
  offset?: number;
}): SpLogsResult {
  const { levelMask = 127, search, since, limit = 200, offset = 0 } = opts;
  const searchLower: string | undefined = search ? search.toLowerCase() : undefined;
  const filtered: SpLogEntry[] = [];

  // Iterate newest-first; break early once we pass the `since` cutoff.
  for (let i = _ring.length - 1; i >= 0; i--) {
    const e = _ring[i]!;
    if (since && e.ts < since) break;
    if (!(e.level & levelMask)) continue;
    if (searchLower && !e.message.toLowerCase().includes(searchLower) && !e.source.toLowerCase().includes(searchLower)) continue;
    filtered.push(e);
  }

  const facets: Record<string, number> = {};
  for (const e of filtered) {
    facets[e.levelName] = (facets[e.levelName] ?? 0) + 1;
  }

  return { entries: filtered.slice(offset, offset + limit), total: filtered.length, facets };
}

export function getActiveMask(): number {
  return _activeMask;
}

export function setActiveMask(mask: number): void {
  _activeMask = Math.max(0, Math.min(127, mask));
}

export function clearLogs(): void {
  _ring.length = 0;
}
