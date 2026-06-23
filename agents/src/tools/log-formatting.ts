/**
 * Pure presentation + aggregation helpers for workspace logs.
 *
 * Lifted from the former `DevSupervisorLogClient` (decorative emoji dropped —
 * the agent parses the text, not the glyphs). They operate on the workspace
 * {@link LogEntry} shape and hold no transport/client state — keeping the
 * workspace `diagnostics` API a thin data surface while the tool owns display.
 */
import type { LogEntry } from '../workspace/diagnostics.js';

/** Filters echoed back in the log header (display only). */
export interface LogFormatFilters {
  source?: 'stdout' | 'stderr';
  lines?: number;
  since?: string;
}

/** Aggregate statistics over a set of log entries. */
export interface LogSummary {
  totalLogs: number;
  sources: Record<string, number>;
  levels: Record<string, number>;
  oldestEntry?: string;
  newestEntry?: string;
}

/** Short uppercase tag for a log source (e.g. STDOUT, STDERR). */
export function formatSource(source: string): string {
  return source.toUpperCase();
}

/** Render log entries as a markdown block with a filter header. */
export function formatLogs(logs: LogEntry[], filters: LogFormatFilters = {}): string {
  if (logs.length === 0) {
    return 'No logs found.';
  }

  const lines: string[] = [];

  // Header with the filters that were applied
  const applied: string[] = [];
  if (filters.source) {
    applied.push(`source: ${filters.source}`);
  }
  if (filters.lines) {
    applied.push(`lines: ${filters.lines}`);
  }
  if (filters.since) {
    applied.push(`since: ${filters.since}`);
  }

  if (applied.length > 0) {
    lines.push(`**Log Filters:** ${applied.join(', ')}`);
    lines.push('');
  }

  lines.push(`**Total Entries:** ${logs.length}`);
  lines.push('');
  lines.push('**Log Entries:**');
  lines.push('```');

  for (const entry of logs) {
    const timestamp = new Date(entry.timestamp).toISOString();
    const source = formatSource(entry.source);
    const level = entry.level ? ` [${entry.level.toUpperCase()}]` : '';
    const message = entry.message.trim();

    lines.push(`${timestamp}${level} [${source}] ${message}`);
  }

  lines.push('```');

  return lines.join('\n');
}

/** Aggregate source/level counts and the time range over log entries. */
export function summarizeLogs(logs: LogEntry[]): LogSummary {
  if (logs.length === 0) {
    return { totalLogs: 0, sources: {}, levels: {} };
  }

  const sources: Record<string, number> = {};
  const levels: Record<string, number> = {};
  let oldest = Infinity;
  let newest = -Infinity;

  for (const log of logs) {
    sources[log.source] = (sources[log.source] || 0) + 1;
    if (log.level) {
      levels[log.level] = (levels[log.level] || 0) + 1;
    }

    const time = new Date(log.timestamp).getTime();
    if (time < oldest) oldest = time;
    if (time > newest) newest = time;
  }

  return {
    totalLogs: logs.length,
    sources,
    levels,
    oldestEntry: new Date(oldest).toISOString(),
    newestEntry: new Date(newest).toISOString(),
  };
}

/** Render a {@link LogSummary} as markdown for display. */
export function formatLogSummary(summary: LogSummary): string {
  const lines: string[] = [];

  lines.push('**Log Summary**');
  lines.push('');
  lines.push(`**Total Logs:** ${summary.totalLogs}`);

  if (summary.oldestEntry && summary.newestEntry) {
    lines.push(`**Time Range:** ${summary.oldestEntry} to ${summary.newestEntry}`);
  }

  lines.push('');

  if (Object.keys(summary.sources).length > 0) {
    lines.push('**Sources:**');
    for (const [source, count] of Object.entries(summary.sources)) {
      lines.push(`  ${source}: ${count}`);
    }
    lines.push('');
  }

  if (Object.keys(summary.levels).length > 0) {
    lines.push('**Log Levels:**');
    for (const [level, count] of Object.entries(summary.levels)) {
      lines.push(`  ${level}: ${count}`);
    }
  }

  return lines.join('\n');
}
