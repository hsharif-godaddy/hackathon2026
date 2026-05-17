import { describe, expect, it } from 'vitest';

import { groupErrorLogs } from '@/lib/log-error-groups';
import type { LogEntry } from '@/lib/log-types';

function entry(partial: Partial<LogEntry> & { level: string }): LogEntry {
  return {
    id: Math.random().toString(36),
    timestamp: '2026-05-17T10:00:00.000Z',
    message: 'msg',
    raw: {},
    ...partial,
  } as LogEntry;
}

describe('groupErrorLogs', () => {
  it('skips non-error entries', () => {
    const result = groupErrorLogs([
      entry({ level: 'info', message: 'startup' }),
      entry({ level: 'warn', message: 'slow query' }),
      entry({ level: 'error', message: 'boom' }),
    ]);
    expect(result.total).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].message).toBe('boom');
  });

  it('skips empty / whitespace-only messages', () => {
    const result = groupErrorLogs([
      entry({ level: 'error', message: '' }),
      entry({ level: 'error', message: '   ' }),
      entry({ level: 'error', message: 'real error' }),
    ]);
    expect(result.total).toBe(1);
    expect(result.groups).toHaveLength(1);
  });

  it('groups by trimmed message', () => {
    const result = groupErrorLogs([
      entry({ level: 'error', message: 'oops' }),
      entry({ level: 'error', message: '  oops  ' }),
      entry({ level: 'error', message: 'oops' }),
      entry({ level: 'error', message: 'other' }),
    ]);
    expect(result.total).toBe(4);
    expect(result.groups).toHaveLength(2);
    const oops = result.groups.find((g) => g.message === 'oops');
    expect(oops?.count).toBe(3);
  });

  it('sorts by count descending', () => {
    const result = groupErrorLogs([
      entry({ level: 'error', message: 'a' }),
      entry({ level: 'error', message: 'b' }),
      entry({ level: 'error', message: 'b' }),
      entry({ level: 'error', message: 'b' }),
      entry({ level: 'error', message: 'c' }),
      entry({ level: 'error', message: 'c' }),
    ]);
    expect(result.groups.map((g) => g.message)).toEqual(['b', 'c', 'a']);
  });

  it('tracks lastSeen as max timestamp', () => {
    const result = groupErrorLogs([
      entry({ level: 'error', message: 'x', timestamp: '2026-05-17T10:00:00.000Z' }),
      entry({ level: 'error', message: 'x', timestamp: '2026-05-17T11:00:00.000Z' }),
      entry({ level: 'error', message: 'x', timestamp: '2026-05-17T09:00:00.000Z' }),
    ]);
    expect(result.groups[0].lastSeen).toBe('2026-05-17T11:00:00.000Z');
  });

  it('uses the first non-empty event seen for the group', () => {
    const result = groupErrorLogs([
      entry({ level: 'error', message: 'y', event: 'first.event' }),
      entry({ level: 'error', message: 'y', event: 'second.event' }),
      entry({ level: 'error', message: 'y' }),
    ]);
    expect(result.groups[0].event).toBe('first.event');
  });

  it('falls back to a later event when the first instance has none', () => {
    const result = groupErrorLogs([
      entry({ level: 'error', message: 'z' }),
      entry({ level: 'error', message: 'z', event: 'late.event' }),
    ]);
    expect(result.groups[0].event).toBe('late.event');
  });

  it('returns an empty result for no inputs', () => {
    expect(groupErrorLogs([])).toEqual({ groups: [], total: 0 });
  });
});
