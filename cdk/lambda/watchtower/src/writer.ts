import type { Client } from '@elastic/elasticsearch';
import type { StatData, StatsDoc, WindowKind } from './types.js';

export function buildStatsDoc(
  data: StatData,
  window: WindowKind,
  atIso: string,
  notes: string,
  errorEventNames: string[] = [],
): StatsDoc {
  return { '@timestamp': atIso, window, data, error_event_names: errorEventNames, notes };
}

export async function writeStatsDoc(client: Client, statsIndex: string, doc: StatsDoc): Promise<void> {
  // Deterministic id (window-end + window kind) makes the write idempotent:
  // EventBridge is at-least-once and retryAttempts is 0, so a double-fire for
  // the same hour overwrites rather than appending a duplicate row that would
  // inflate the daily count totals. Also pre-stages the Phase-3 re-upsert.
  await client.index({ index: statsIndex, id: `${doc['@timestamp']}|${doc.window}`, document: doc });
}
