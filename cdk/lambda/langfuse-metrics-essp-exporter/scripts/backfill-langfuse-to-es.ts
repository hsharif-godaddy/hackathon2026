/**
 * Backfill Langfuse hourly metrics into Elasticsearch.
 *
 * Each day in the [START_DATE, END_DATE] range produces ONE call per query
 * definition (5 calls/day) using `timeDimension: { granularity: 'hour' }`,
 * which returns 24 hourly buckets per dimension combo per call.
 *
 * Required env (read from .env via dotenv):
 *   LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 *   ES_ENDPOINT (or AIRO_BUILDER_ES_ENDPOINT), ES_API_KEY (or AIRO_BUILDER_ES_API_KEY)
 *
 * Optional env:
 *   START_DATE   YYYY-MM-DD (default: 7 days ago, UTC)
 *   END_DATE     YYYY-MM-DD inclusive (default: today, UTC)
 *   ES_INDEX     override target index (default: langfuse-metrics-hourly)
 *   DRY_RUN      "true" to skip ES writes
 *
 * Usage:
 *   pnpm --filter langfuse-metrics-essp-exporter backfill-langfuse
 *   START_DATE=2026-04-15 END_DATE=2026-04-22 pnpm --filter langfuse-metrics-essp-exporter backfill-langfuse
 */

import 'dotenv/config';

import { Client } from '@elastic/elasticsearch';

import {
  bulkIndex,
  createEsClient,
  definitions,
  ensureIndex,
  ES_INDEX,
  fetchMetrics,
  filterResponse,
  INDEX_MAPPING,
  LangfuseConfig,
  mergeAll,
  MetricsResponse,
} from '../src/shared.js';

const DRY_RUN = process.env.DRY_RUN === 'true';
const INDEX = process.env.ES_INDEX ?? ES_INDEX;

function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!v) throw new Error(`Missing required env: ${name}${fallback ? ` (or ${fallback})` : ''}`);
  return v;
}

function loadLangfuse(): LangfuseConfig {
  return {
    baseUrl: requireEnv('LANGFUSE_BASE_URL'),
    publicKey: requireEnv('LANGFUSE_PUBLIC_KEY'),
    secretKey: requireEnv('LANGFUSE_SECRET_KEY'),
  };
}

function loadEs(): Client {
  const endpoint = requireEnv('ES_ENDPOINT', 'AIRO_BUILDER_ES_ENDPOINT');
  const apiKey = process.env.ES_API_KEY ?? process.env.AIRO_BUILDER_ES_API_KEY;
  if (!apiKey) throw new Error('Missing ES_API_KEY (or AIRO_BUILDER_ES_API_KEY)');
  return createEsClient({ url: endpoint, api_key: apiKey });
}

function dateRange(): { start: Date; end: Date } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // -6 (not -7) so the default range produces 7 days inclusive of today,
  // matching the comment "7 days ago, UTC".
  const defaultStart = new Date(today);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 6);

  const start = process.env.START_DATE
    ? new Date(`${process.env.START_DATE}T00:00:00.000Z`)
    : defaultStart;
  const end = process.env.END_DATE
    ? new Date(`${process.env.END_DATE}T00:00:00.000Z`)
    : today;

  if (Number.isNaN(start.getTime())) throw new Error(`Invalid START_DATE: ${process.env.START_DATE}`);
  if (Number.isNaN(end.getTime())) throw new Error(`Invalid END_DATE: ${process.env.END_DATE}`);
  if (start > end) throw new Error(`START_DATE (${start.toISOString()}) must be <= END_DATE (${end.toISOString()})`);

  return { start, end };
}

function listDays(start: Date, end: Date): Array<{ from: string; to: string; label: string }> {
  const out: Array<{ from: string; to: string; label: string }> = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + 1);
    out.push({
      from: d.toISOString(),
      to: next.toISOString(),
      label: d.toISOString().slice(0, 10),
    });
  }
  return out;
}

async function run(): Promise<void> {
  const lf = loadLangfuse();
  const esClient: Client | null = DRY_RUN ? null : loadEs();

  if (esClient) {
    await esClient.cluster.health().catch(function fail(err: Error) {
      throw new Error('ES health check failed', { cause: err });
    });
    await ensureIndex(esClient, INDEX, INDEX_MAPPING);
  }

  const { start, end } = dateRange();
  const days = listDays(start, end);
  console.log(
    'Backfill %s → %s (%d days), index=%s%s',
    days[0].label, days[days.length - 1].label, days.length, INDEX,
    DRY_RUN ? ' [DRY_RUN]' : ''
  );

  let totalIndexed = 0;
  let failedDays = 0;
  for (const day of days) {
    console.log('\n--- %s ---', day.label);

    // Abort the whole day on any query, merge, or index failure: partial query
    // results would misclassify failures as SPAN-only (observation_failures
    // merge depends on generationKeys built from observation_tokens /
    // latency_by_model), and bulkIndex now throws on partial-write failures.
    // Skip the bad day and continue; the operator can re-run it.
    try {
      const responses = new Map<string, MetricsResponse>();
      for (const def of definitions) {
        const raw = await fetchMetrics(lf, def.build({ fromTimestamp: day.from, toTimestamp: day.to }));
        const filtered = filterResponse(raw);
        responses.set(def.metricType, filtered);
        console.log('  %s: %d rows', def.name, filtered.data.length);
      }

      const docs = mergeAll(responses);
      console.log('  merged: %d docs', docs.length);

      if (docs.length === 0) continue;

      if (!esClient) {
        console.log('  [DRY_RUN] would index %d docs', docs.length);
        totalIndexed += docs.length;
        continue;
      }

      const indexed = await bulkIndex(esClient, INDEX, docs);
      console.log('  indexed: %d docs', indexed);
      totalIndexed += indexed;
    } catch (err) {
      // Pass the Error object (not .message) so Node prints the full stack
      // and `cause` chain — bulkIndex wraps ES client errors and the root
      // cause would otherwise be invisible in the log.
      console.error('  day FAILED:', err);
      failedDays++;
      continue;
    }
  }

  console.log(
    '\nDone. Total docs %s: %d (failed days: %d)',
    esClient ? 'indexed' : 'would-index', totalIndexed, failedDays
  );
  if (failedDays > 0) process.exit(1);
}

run().catch(function fatal(err) {
  console.error(err);
  process.exit(1);
});
