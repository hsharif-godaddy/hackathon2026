import type { Client } from '@elastic/elasticsearch';

export interface AgentsTracesStats {
  agents_invocation_count: number;
  agents_invocation_failure_count: number;
  agents_invocation_abort_count: number;
  agents_invocation_fetch_fail_count: number;
  agents_toolcall_count: number;
  agents_outbound_timeout_count: number;
  /** Top tool names invoked this hour — for LLM context, not a numeric metric. */
  agentToolNames: string[];
}

interface InvokeAgg {
  doc_count?: number;
  failures?: { doc_count?: number };
  aborts?: { doc_count?: number };
  fetch_fails?: { doc_count?: number };
}

interface ToolcallAgg {
  doc_count?: number;
  tool_names?: { buckets?: { key: string; doc_count: number }[] };
}

export interface AgentsTracesAggResponse {
  aggregations?: {
    invoke_agent?: InvokeAgg;
    toolcalls?: ToolcallAgg;
    outbound_errors?: { doc_count?: number };
  };
}

export function buildAgentsTracesAggQuery(startIso: string, endIso: string): Record<string, unknown> {
  return {
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { 'service.name': 'airo-agents' } },
          { range: { '@timestamp': { gte: startIso, lt: endIso } } },
        ],
      },
    },
    aggs: {
      invoke_agent: {
        filter: { term: { 'span.name': 'invoke_agent unknown' } },
        aggs: {
          failures:    { filter: { term: { 'labels.agent_execution_outcome': 'FAILURE' } } },
          // gen_ai_response_finish_reasons is an array field; term filter matches any element
          aborts:      { filter: { term: { 'labels.gen_ai_response_finish_reasons': 'aborted' } } },
          fetch_fails: { filter: { term: { 'labels.gen_ai_response_finish_reasons': 'result_fetch_failed' } } },
        },
      },
      toolcalls: {
        filter: { term: { 'span.name': 'ai.toolCall' } },
        aggs: {
          // ai_toolCall_name is a standalone indexed keyword field — directly aggregatable
          tool_names: { terms: { field: 'labels.ai_toolCall_name', size: 20 } },
        },
      },
      outbound_errors: {
        // HTTP spans with an error_type label = outbound downstream failures (timeouts etc)
        filter: {
          bool: {
            must: [
              { term: { 'span.subtype': 'http' } },
              { exists: { field: 'labels.error_type' } },
            ],
          },
        },
      },
    },
  };
}

export function mapAgentsTracesResponse(resp: AgentsTracesAggResponse): AgentsTracesStats {
  const a = resp.aggregations ?? {};
  const toolBuckets = a.toolcalls?.tool_names?.buckets ?? [];
  return {
    agents_invocation_count: a.invoke_agent?.doc_count ?? 0,
    agents_invocation_failure_count: a.invoke_agent?.failures?.doc_count ?? 0,
    agents_invocation_abort_count: a.invoke_agent?.aborts?.doc_count ?? 0,
    agents_invocation_fetch_fail_count: a.invoke_agent?.fetch_fails?.doc_count ?? 0,
    agents_toolcall_count: a.toolcalls?.doc_count ?? 0,
    agents_outbound_timeout_count: a.outbound_errors?.doc_count ?? 0,
    agentToolNames: toolBuckets.map((b) => b.key),
  };
}

export async function collectAgentsTraces(
  client: Client,
  tracesIndex: string,
  startIso: string,
  endIso: string,
): Promise<AgentsTracesStats> {
  const body = buildAgentsTracesAggQuery(startIso, endIso);
  const resp = await client.search({ index: tracesIndex, body });
  return mapAgentsTracesResponse(resp as unknown as AgentsTracesAggResponse);
}
