import type { Client } from '@elastic/elasticsearch';

export interface AgentsLogStats {
  agents_ai_call_count: number;
  agents_http_error_count: number;
  agents_auth_failure_count: number;
  agents_embedding_error_count: number;
}

const AI_PROVIDER_EVENTS = [
  'ai-lib.unified-provider.provider.anthropic',
  'ai-lib.unified-provider.provider.s2s.anthropic',
  'ai-lib.unified-provider.provider.s2s.openai',
];

export interface AgentsLogAggResponse {
  aggregations?: Record<string, { doc_count?: number }>;
}

export function buildAgentsLogsAggQuery(startIso: string, endIso: string): Record<string, unknown> {
  return {
    size: 0,
    query: { range: { '@timestamp': { gte: startIso, lt: endIso } } },
    aggs: {
      ai_calls: { filter: { terms: { event: AI_PROVIDER_EVENTS } } },
      http_errors: { filter: { term: { event: 'http.request.error' } } },
      auth_failures: { filter: { term: { event: 'jwt.auth.missing_bearer' } } },
      embedding_errors: {
        filter: {
          terms: { event: ['embedding_classifier.initialization.error', 'server.embedding_classifier.init.failed'] },
        },
      },
    },
  };
}

export function mapAgentsLogsResponse(resp: AgentsLogAggResponse): AgentsLogStats {
  const a = resp.aggregations ?? {};
  return {
    agents_ai_call_count: a.ai_calls?.doc_count ?? 0,
    agents_http_error_count: a.http_errors?.doc_count ?? 0,
    agents_auth_failure_count: a.auth_failures?.doc_count ?? 0,
    agents_embedding_error_count: a.embedding_errors?.doc_count ?? 0,
  };
}

export async function collectAgentsLogs(
  client: Client,
  agentsLogIndex: string,
  startIso: string,
  endIso: string,
): Promise<AgentsLogStats> {
  const body = buildAgentsLogsAggQuery(startIso, endIso);
  const resp = await client.search({ index: agentsLogIndex, body });
  return mapAgentsLogsResponse(resp as unknown as AgentsLogAggResponse);
}
