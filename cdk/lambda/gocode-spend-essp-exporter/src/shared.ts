export interface Metrics {
  spend: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_tokens: number;
  successful_requests: number;
  failed_requests: number;
  api_requests: number;
}

export interface BreakdownEntry {
  metrics: Metrics;
  api_key_breakdown?: Record<string, { metrics: Metrics }>;
}

export interface DailyResult {
  date: string;
  breakdown: {
    entities?: Record<string, BreakdownEntry>;
    models?: Record<string, BreakdownEntry>;
  };
}

export interface DailyResponse {
  results?: DailyResult[];
  metadata?: { total_pages?: number };
}

export interface ModelDoc {
  date: string;
  model: string;
  model_raw: string;
  spend: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_tokens: number;
  successful_requests: number;
  failed_requests: number;
  api_requests: number;
}

export interface EndUserDoc {
  date: string;
  end_user: string;
  spend: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_tokens: number;
  successful_requests: number;
  failed_requests: number;
  api_requests: number;
}

export const ES_INDEX_MODEL = 'llm_spend_model_daily';
export const ES_INDEX_ENDUSER = 'llm_spend_enduser_daily';
export const ENTITY_PREFIX = 'airo-build:sid:';
export const BUILDER_PREFIX = 'airo-builder:';
export const PARALLEL_PAGES = 10;
export const ES_BATCH_SIZE = 500;

export function normalizeModelName(raw: string): string {
  if (raw.startsWith('bedrock/us.anthropic.')) {
    return raw.replace('bedrock/us.anthropic.', '');
  }
  if (raw.startsWith('us.anthropic.')) {
    return raw.replace('us.anthropic.', '');
  }
  if (raw.startsWith('bedrock/us.')) {
    return raw.replace('bedrock/us.', '');
  }
  return raw;
}

export function extractModelDocs(results: DailyResult[], entityArn: string): ModelDoc[] {
  const modelMap = new Map<string, ModelDoc>();

  for (const result of results) {
    const entityData = result.breakdown?.entities?.[entityArn];
    if (!entityData) continue;

    const entityApiKeys = Object.keys(entityData.api_key_breakdown || {});
    const models = result.breakdown?.models || {};

    for (const [modelRaw, modelData] of Object.entries(models)) {
      for (const apiKey of entityApiKeys) {
        const keyMetrics = modelData.api_key_breakdown?.[apiKey]?.metrics;
        if (!keyMetrics) continue;

        const normalized = normalizeModelName(modelRaw);
        const key = `${result.date}-${normalized}`;
        const existing = modelMap.get(key);

        if (existing) {
          existing.spend += keyMetrics.spend;
          existing.prompt_tokens += keyMetrics.prompt_tokens;
          existing.completion_tokens += keyMetrics.completion_tokens;
          existing.cache_read_input_tokens += keyMetrics.cache_read_input_tokens;
          existing.cache_creation_input_tokens += keyMetrics.cache_creation_input_tokens;
          existing.total_tokens += keyMetrics.total_tokens;
          existing.successful_requests += keyMetrics.successful_requests;
          existing.failed_requests += keyMetrics.failed_requests;
          existing.api_requests += keyMetrics.api_requests;
        } else {
          modelMap.set(key, {
            date: result.date,
            model: normalized,
            model_raw: modelRaw,
            spend: keyMetrics.spend,
            prompt_tokens: keyMetrics.prompt_tokens,
            completion_tokens: keyMetrics.completion_tokens,
            cache_read_input_tokens: keyMetrics.cache_read_input_tokens,
            cache_creation_input_tokens: keyMetrics.cache_creation_input_tokens,
            total_tokens: keyMetrics.total_tokens,
            successful_requests: keyMetrics.successful_requests,
            failed_requests: keyMetrics.failed_requests,
            api_requests: keyMetrics.api_requests
          });
        }
      }
    }
  }

  return [...modelMap.values()];
}

export function extractEndUserDocs(results: DailyResult[]): EndUserDoc[] {
  const userMap = new Map<string, EndUserDoc>();

  for (const result of results) {
    const entities = result.breakdown?.entities || {};
    for (const [entityName, entityData] of Object.entries(entities)) {
      if (!entityName.startsWith(ENTITY_PREFIX) && !entityName.startsWith(BUILDER_PREFIX)) continue;

      const m = entityData.metrics;
      const key = `${result.date}-${entityName}`;
      const existing = userMap.get(key);

      if (existing) {
        existing.spend += m.spend;
        existing.prompt_tokens += m.prompt_tokens;
        existing.completion_tokens += m.completion_tokens;
        existing.cache_read_input_tokens += m.cache_read_input_tokens;
        existing.cache_creation_input_tokens += m.cache_creation_input_tokens;
        existing.total_tokens += m.total_tokens;
        existing.successful_requests += m.successful_requests;
        existing.failed_requests += m.failed_requests;
        existing.api_requests += m.api_requests;
      } else {
        userMap.set(key, {
          date: result.date,
          end_user: entityName,
          spend: m.spend,
          prompt_tokens: m.prompt_tokens,
          completion_tokens: m.completion_tokens,
          cache_read_input_tokens: m.cache_read_input_tokens,
          cache_creation_input_tokens: m.cache_creation_input_tokens,
          total_tokens: m.total_tokens,
          successful_requests: m.successful_requests,
          failed_requests: m.failed_requests,
          api_requests: m.api_requests
        });
      }
    }
  }

  return [...userMap.values()];
}

export type PageFetcher = (jwt: string, params: URLSearchParams, page: number) => Promise<DailyResponse>;

export async function fetchAllPages(
  jwt: string,
  fetcher: PageFetcher,
  params: URLSearchParams
): Promise<DailyResult[]> {
  const first = await fetcher(jwt, params, 1);
  const totalPages = first.metadata?.total_pages ?? 1;
  const allResults = [...(first.results ?? [])];

  if (totalPages > 1) {
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    for (let i = 0; i < remaining.length; i += PARALLEL_PAGES) {
      const batch = remaining.slice(i, i + PARALLEL_PAGES);
      const pages = await Promise.all(batch.map(p => fetcher(jwt, params, p)));
      for (const page of pages) allResults.push(...(page.results ?? []));
    }
  }

  return allResults;
}
