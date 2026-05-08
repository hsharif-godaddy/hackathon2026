import { Client } from '@elastic/elasticsearch';

import { logger } from '@/lib/logger';

const WRITE_ES_URL = process.env.AIRO_BUILDER_ES_ENDPOINT || 'http://localhost:9200';

// Write client used by credit-pack-utils for its small transactional store.
// Everything else has moved to direct Loki / Katana ES queries.
export const writeClient = new Client({
  node: WRITE_ES_URL,
  auth: {
    apiKey: process.env.AIRO_BUILDER_ES_API_KEY || ''
  }
});

const INDEX_PREFIX = process.env.ES_INDEX_PREFIX || 'airo_analytics_';

export const INDICES = {
  CREDIT_PACKS: `${INDEX_PREFIX}credit_packs`,
} as const;

const MAPPINGS = {
  [INDICES.CREDIT_PACKS]: {
    properties: {
      es_id: { type: 'keyword' },
      timestamp: { type: 'date' },
      app_id: { type: 'keyword' },
      subscription_id: { type: 'keyword' },
      status: { type: 'keyword' },
      credits_max: { type: 'integer' },
      use_before: { type: 'date' },
      next_credit_allowed_after: { type: 'date' },
      added_by_shopper_id: { type: 'keyword' },
      added_by_cid: { type: 'keyword' },
      added_by_email: { type: 'keyword' },
      llm_budget_user_id: { type: 'keyword' },
      // Used by lock documents; requires an ILM policy with a delete phase
      // keyed on this field to auto-clean stale locks
      expire_at: { type: 'date' },
      notes: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword', ignore_above: 32000 }
        }
      }
    }
  },
};

export async function initIndices(indicesToInit: string[] = Object.values(INDICES), forceUpdate: boolean = false) {
  for (const indexName of indicesToInit) {
    const mapping = MAPPINGS[indexName as keyof typeof MAPPINGS];
    if (!mapping) {
      logger.warn('es.index.init.no-mapping', { indexName });
      continue;
    }
    const exists = await writeClient.indices.exists({ index: indexName });
    if (!exists) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeClient.indices.create({ index: indexName, mappings: mapping } as any);
      logger.info('es.index.init.created', { indexName });
    } else if (forceUpdate) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await writeClient.indices.putMapping({ index: indexName, ...mapping } as any);
        logger.info('es.index.mapping.updated', { indexName });
      } catch (error) {
        logger.error('es.index.mapping.update.failed', { indexName }, { error: error as Error });
      }
    } else {
      logger.info('es.index.init.exists', { indexName });
    }
  }
}

interface BulkDoc {
  index: string;
  id: string;
  doc: Record<string, unknown>;
}

export async function bulkIndex(docs: BulkDoc[]) {
  if (docs.length === 0) return;

  const body = docs.flatMap(({ index, id, doc }) => [
    { index: { _index: index, _id: id } },
    doc
  ]);

  const result = await writeClient.bulk({ body, refresh: false });

  if (result.errors) {
    const errorItems = result.items.filter(item => item.index?.error);
    const samples = errorItems.slice(0, 3).map(item => ({
      index: item.index?._index,
      error: item.index?.error,
    }));
    logger.error('es.bulk.errors', {
      errorCount: errorItems.length,
      samples,
    });
    const firstReason =
      typeof samples[0]?.error === 'object' && samples[0]?.error !== null
        ? (samples[0].error as { reason?: string }).reason || JSON.stringify(samples[0].error)
        : String(samples[0]?.error ?? 'unknown');
    throw new Error(
      `Bulk index reported ${errorItems.length} error(s). First: ${firstReason}`,
    );
  }

  return result;
}
