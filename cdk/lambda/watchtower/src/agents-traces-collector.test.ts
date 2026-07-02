import { describe, it, expect, vi } from 'vitest';
import { buildAgentsTracesAggQuery, mapAgentsTracesResponse, collectAgentsTraces } from './agents-traces-collector.js';

describe('buildAgentsTracesAggQuery', () => {
  it('filters by service.name=airo-agents and timestamp range', () => {
    const body = buildAgentsTracesAggQuery('2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z');
    const json = JSON.stringify(body);
    expect(json).toContain('airo-agents');
    expect(json).toContain('invoke_agent unknown');
    expect(json).toContain('ai.toolCall');
    expect(json).toContain('ai_toolCall_name');
  });
});

describe('mapAgentsTracesResponse', () => {
  it('emits zeros and empty tool names when aggregations absent', () => {
    const result = mapAgentsTracesResponse({});
    expect(result.agents_invocation_count).toBe(0);
    expect(result.agents_invocation_failure_count).toBe(0);
    expect(result.agents_invocation_abort_count).toBe(0);
    expect(result.agents_invocation_fetch_fail_count).toBe(0);
    expect(result.agents_toolcall_count).toBe(0);
    expect(result.agents_outbound_timeout_count).toBe(0);
    expect(result.agentToolNames).toEqual([]);
  });

  it('extracts all invocation outcome counts and tool names from buckets', () => {
    const resp = {
      aggregations: {
        invoke_agent: {
          doc_count: 50,
          failures:    { doc_count: 3 },
          aborts:      { doc_count: 2 },
          fetch_fails: { doc_count: 1 },
        },
        toolcalls: {
          doc_count: 120,
          tool_names: {
            buckets: [
              { key: 'str_replace_based_edit_tool', doc_count: 80 },
              { key: 'readFile', doc_count: 40 },
            ],
          },
        },
        outbound_errors: { doc_count: 5 },
      },
    };
    const result = mapAgentsTracesResponse(resp);
    expect(result.agents_invocation_count).toBe(50);
    expect(result.agents_invocation_failure_count).toBe(3);
    expect(result.agents_invocation_abort_count).toBe(2);
    expect(result.agents_invocation_fetch_fail_count).toBe(1);
    expect(result.agents_toolcall_count).toBe(120);
    expect(result.agents_outbound_timeout_count).toBe(5);
    expect(result.agentToolNames).toEqual(['str_replace_based_edit_tool', 'readFile']);
  });

  it('preserves bucket order (already sorted by ES by count desc)', () => {
    const resp = {
      aggregations: {
        toolcalls: {
          tool_names: { buckets: [{ key: 'a', doc_count: 10 }, { key: 'b', doc_count: 5 }] },
        },
      },
    };
    expect(mapAgentsTracesResponse(resp).agentToolNames).toEqual(['a', 'b']);
  });
});

describe('collectAgentsTraces (ES response seam)', () => {
  it('passes query to client.search and maps the response', async () => {
    const mockResp = {
      aggregations: {
        invoke_agent: { doc_count: 10, failures: { doc_count: 1 }, aborts: { doc_count: 0 }, fetch_fails: { doc_count: 0 } },
        toolcalls: { doc_count: 30, tool_names: { buckets: [] } },
        outbound_errors: { doc_count: 2 },
      },
    };
    const search = vi.fn().mockResolvedValue(mockResp);
    const result = await collectAgentsTraces({ search } as never, 'traces-index', 'start', 'end');
    expect(search).toHaveBeenCalledOnce();
    expect(result.agents_invocation_count).toBe(10);
    expect(result.agents_invocation_failure_count).toBe(1);
    expect(result.agents_toolcall_count).toBe(30);
  });
});
