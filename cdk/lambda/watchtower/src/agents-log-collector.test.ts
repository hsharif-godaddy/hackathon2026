import { describe, it, expect, vi } from 'vitest';
import { buildAgentsLogsAggQuery, mapAgentsLogsResponse, collectAgentsLogs } from './agents-log-collector.js';

describe('buildAgentsLogsAggQuery', () => {
  it('includes all AI provider event names', () => {
    const body = buildAgentsLogsAggQuery('start', 'end');
    const json = JSON.stringify(body);
    expect(json).toContain('ai-lib.unified-provider.provider.anthropic');
    expect(json).toContain('ai-lib.unified-provider.provider.s2s.anthropic');
    expect(json).toContain('ai-lib.unified-provider.provider.s2s.openai');
    expect(json).toContain('jwt.auth.missing_bearer');
    expect(json).toContain('embedding_classifier.initialization.error');
  });
});

describe('mapAgentsLogsResponse', () => {
  it('emits zeros when aggregations absent', () => {
    const result = mapAgentsLogsResponse({});
    expect(result.agents_ai_call_count).toBe(0);
    expect(result.agents_http_error_count).toBe(0);
    expect(result.agents_auth_failure_count).toBe(0);
    expect(result.agents_embedding_error_count).toBe(0);
  });

  it('maps aggregation doc_counts to the correct fields', () => {
    const resp = {
      aggregations: {
        ai_calls:        { doc_count: 500 },
        http_errors:     { doc_count: 30 },
        auth_failures:   { doc_count: 10 },
        embedding_errors: { doc_count: 2 },
      },
    };
    const result = mapAgentsLogsResponse(resp);
    expect(result.agents_ai_call_count).toBe(500);
    expect(result.agents_http_error_count).toBe(30);
    expect(result.agents_auth_failure_count).toBe(10);
    expect(result.agents_embedding_error_count).toBe(2);
  });
});

describe('collectAgentsLogs (ES response seam)', () => {
  it('passes query to client.search and maps the response', async () => {
    const mockResp = {
      aggregations: {
        ai_calls: { doc_count: 200 },
        http_errors: { doc_count: 5 },
        auth_failures: { doc_count: 0 },
        embedding_errors: { doc_count: 1 },
      },
    };
    const search = vi.fn().mockResolvedValue(mockResp);
    const result = await collectAgentsLogs({ search } as never, 'agents-log-index', 'start', 'end');
    expect(search).toHaveBeenCalledOnce();
    expect(result.agents_ai_call_count).toBe(200);
    expect(result.agents_embedding_error_count).toBe(1);
  });
});
