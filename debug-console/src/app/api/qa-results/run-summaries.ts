import type { Client } from '@elastic/elasticsearch';

const QA_INDEX = 'agentic-qa-results';

export const RUN_NUMBER_TERMS_FIELDS = ['runNumber.keyword', 'runNumber'] as const;

type FilterAgg = { doc_count?: number };

export type RunSummaryBucket = {
  key: number | string;
  max_ts?: { value_as_string?: string; value?: number | null };
  passed?: FilterAgg;
  failed?: FilterAgg;
  sample?: { hits?: { hits?: Array<{ _source?: Record<string, unknown> }> } };
};

export function isRunNumberFieldError(error: unknown): boolean {
  const err = error as { message?: string; meta?: { body?: { error?: { reason?: string } } } };
  const reason = err.meta?.body?.error?.reason ?? err.message ?? '';
  return /runNumber|fielddata|keyword|aggregation|mapped as \[text\]/i.test(reason);
}

export function mapRunSummaryBuckets(buckets: RunSummaryBucket[]) {
  return buckets
    .map(function mapRun(b) {
      const hit = b.sample?.hits?.hits?.[0]?._source ?? {};
      const env = typeof hit.environment === 'string' ? hit.environment : 'unknown';
      const eventName = typeof hit.eventName === 'string' ? hit.eventName : '';
      const triggerActor = typeof hit.triggerActor === 'string' ? hit.triggerActor : '';
      const actor = typeof hit.actor === 'string' ? hit.actor : '';
      const ts =
        typeof hit.timestamp === 'string'
          ? hit.timestamp
          : (b.max_ts?.value_as_string ?? '');
      return {
        runNumber: String(b.key),
        timestamp: ts,
        passed: b.passed?.doc_count ?? 0,
        failed: b.failed?.doc_count ?? 0,
        environment: env,
        eventName,
        triggerActor: triggerActor || actor,
      };
    })
    .sort(function sortByTimestampDesc(a, b) {
      const ta = Date.parse(a.timestamp);
      const tb = Date.parse(b.timestamp);
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
}

export async function searchRunSummaries(
  client: Client,
  gte: string,
  lte: string,
) {
  const aggs = (runField: string) => ({
    runs: {
      terms: {
        field: runField,
        size: 80,
        order: { max_ts: 'desc' as const },
      },
      aggs: {
        max_ts: { max: { field: 'timestamp' } },
        passed: { filter: { term: { success: true } } },
        failed: { filter: { term: { success: false } } },
        sample: {
          top_hits: {
            size: 1,
            sort: [{ timestamp: 'desc' }],
            _source: {
              includes: [
                'environment',
                'eventName',
                'triggerActor',
                'actor',
                'workflow',
                'timestamp',
              ],
            },
          },
        },
      },
    },
  });

  let lastError: unknown;
  for (let i = 0; i < RUN_NUMBER_TERMS_FIELDS.length; i++) {
    const runField = RUN_NUMBER_TERMS_FIELDS[i];
    const isLast = i === RUN_NUMBER_TERMS_FIELDS.length - 1;
    try {
      const result = await client.search({
        index: QA_INDEX,
        size: 0,
        body: {
          query: { range: { timestamp: { gte, lte } } },
          aggs: aggs(runField),
        },
      });
      const buckets =
        (result.aggregations as { runs?: { buckets?: RunSummaryBucket[] } } | undefined)?.runs
          ?.buckets ?? [];
      return mapRunSummaryBuckets(buckets);
    } catch (error) {
      lastError = error;
      if (isLast || !isRunNumberFieldError(error)) throw error;
    }
  }
  throw lastError;
}
