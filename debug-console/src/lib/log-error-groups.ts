import type { LogEntry } from '@/lib/log-types';

export interface ErrorGroup {
  message: string;
  count: number;
  lastSeen?: string;
  event?: string;
}

export interface ErrorGroupingResult {
  groups: ErrorGroup[];
  total: number;
}

/**
 * Group `error`-level log entries by trimmed message text. Mirrors the
 * server-side aggregation that used to live in app-context/route.ts —
 * trimmed message is the key, count increments, lastSeen tracks the max
 * timestamp, event is captured from the first log seen with that message.
 *
 * Non-error entries are skipped so this can be called against a mixed bag
 * (e.g. a logs cache holding both warns and errors).
 */
export function groupErrorLogs(logs: readonly LogEntry[]): ErrorGroupingResult {
  const map = new Map<string, ErrorGroup>();
  let total = 0;

  for (const log of logs) {
    if (log.level !== 'error') continue;
    const message = (log.message || '').trim();
    if (!message) continue;
    total++;

    const existing = map.get(message);
    if (!existing) {
      map.set(message, {
        message,
        count: 1,
        lastSeen: log.timestamp || undefined,
        event: log.event || undefined,
      });
      continue;
    }

    existing.count++;
    if (log.timestamp && (!existing.lastSeen || log.timestamp > existing.lastSeen)) {
      existing.lastSeen = log.timestamp;
    }
    if (!existing.event && log.event) {
      existing.event = log.event;
    }
  }

  const groups = Array.from(map.values()).sort((a, b) => b.count - a.count);
  return { groups, total };
}
