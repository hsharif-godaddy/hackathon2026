import { describe, it, expect, vi } from 'vitest';
import { buildStatsDoc, writeStatsDoc } from './writer.js';
import { emptyStatData } from './types.js';

describe('buildStatsDoc', () => {
  it('assembles a StatsDoc with timestamp, window, data, error_event_names, and notes', () => {
    const doc = buildStatsDoc(emptyStatData(), '1h', '2026-06-26T14:00:00Z', 'all quiet', ['a.error']);
    expect(doc['@timestamp']).toBe('2026-06-26T14:00:00Z');
    expect(doc.window).toBe('1h');
    expect(doc.notes).toBe('all quiet');
    expect(doc.data.log_count).toBe(0);
    expect(doc.error_event_names).toEqual(['a.error']);
  });

  it('defaults error_event_names to [] when not provided', () => {
    const doc = buildStatsDoc(emptyStatData(), '1h', '2026-06-26T14:00:00Z', '');
    expect(doc.error_event_names).toEqual([]);
  });
});

describe('writeStatsDoc', () => {
  it('indexes the doc with a deterministic id (idempotent on EventBridge double-fire)', async () => {
    const index = vi.fn().mockResolvedValue({ result: 'created' });
    const doc = buildStatsDoc(emptyStatData(), '1h', '2026-06-26T14:00:00Z', '');
    await writeStatsDoc({ index } as never, 'watchtower_stats', doc);
    expect(index).toHaveBeenCalledWith({
      index: 'watchtower_stats',
      id: '2026-06-26T14:00:00Z|1h',
      document: doc,
    });
  });
});
