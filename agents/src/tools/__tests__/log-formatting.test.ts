import { describe, expect, it } from 'vitest';
import { formatLogs, formatSource, summarizeLogs, formatLogSummary } from '../log-formatting.js';
import type { LogEntry } from '../../workspace/diagnostics.js';

const entry = (over: Partial<LogEntry>): LogEntry => ({
  timestamp: new Date('2026-06-01T00:00:00.000Z'),
  source: 'stdout',
  message: 'hello',
  ...over,
});

describe('formatSource', () => {
  it('renders the source as an uppercase tag', () => {
    expect(formatSource('stdout')).toBe('STDOUT');
    expect(formatSource('stderr')).toBe('STDERR');
    expect(formatSource('STDOUT')).toBe('STDOUT');
    expect(formatSource('system')).toBe('SYSTEM');
  });
});

describe('formatLogs', () => {
  it('returns a friendly message when there are no logs', () => {
    expect(formatLogs([])).toBe('No logs found.');
  });

  it('renders a filter header only when filters are supplied', () => {
    const logs = [entry({ message: 'a' })];
    expect(formatLogs(logs)).not.toContain('Log Filters');
    const withFilters = formatLogs(logs, { source: 'stderr', lines: 50, since: '2026-06-01T00:00:00Z' });
    expect(withFilters).toContain('**Log Filters:** source: stderr, lines: 50, since: 2026-06-01T00:00:00Z');
  });

  it('renders each entry with ISO timestamp, level, source tag, and trimmed message', () => {
    const out = formatLogs([
      entry({ source: 'stderr', level: 'error', message: '  boom  ' }),
    ]);
    expect(out).toContain('**Total Entries:** 1');
    expect(out).toContain('2026-06-01T00:00:00.000Z [ERROR] [STDERR] boom');
    expect(out).toContain('```');
  });
});

describe('summarizeLogs', () => {
  it('returns an empty summary for no logs', () => {
    expect(summarizeLogs([])).toEqual({ totalLogs: 0, sources: {}, levels: {} });
  });

  it('counts sources/levels and computes the time range', () => {
    const summary = summarizeLogs([
      entry({ source: 'stdout', level: 'info', timestamp: new Date('2026-06-01T00:00:00.000Z') }),
      entry({ source: 'stderr', level: 'error', timestamp: new Date('2026-06-01T01:00:00.000Z') }),
      entry({ source: 'stdout', timestamp: new Date('2026-06-01T02:00:00.000Z') }),
    ]);
    expect(summary.totalLogs).toBe(3);
    expect(summary.sources).toEqual({ stdout: 2, stderr: 1 });
    expect(summary.levels).toEqual({ info: 1, error: 1 });
    expect(summary.oldestEntry).toBe('2026-06-01T00:00:00.000Z');
    expect(summary.newestEntry).toBe('2026-06-01T02:00:00.000Z');
  });
});

describe('formatLogSummary', () => {
  it('renders totals, time range, and breakdowns', () => {
    const out = formatLogSummary({
      totalLogs: 3,
      sources: { stdout: 2, stderr: 1 },
      levels: { error: 1 },
      oldestEntry: '2026-06-01T00:00:00.000Z',
      newestEntry: '2026-06-01T02:00:00.000Z',
    });
    expect(out).toContain('**Total Logs:** 3');
    expect(out).toContain('**Time Range:** 2026-06-01T00:00:00.000Z to 2026-06-01T02:00:00.000Z');
    expect(out).toContain('stdout: 2');
    expect(out).toContain('stderr: 1');
    expect(out).toContain('error: 1');
  });

  it('omits the time range and breakdowns when absent', () => {
    const out = formatLogSummary({ totalLogs: 0, sources: {}, levels: {} });
    expect(out).toContain('**Total Logs:** 0');
    expect(out).not.toContain('Time Range');
    expect(out).not.toContain('Sources');
  });
});
