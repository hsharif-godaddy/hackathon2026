import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../knowb-search-tool.js', () => ({
  knowBSearchTool: {
    search: vi.fn(),
  },
}));

import { knowBSearchAITool } from '../knowb-search.js';
import { knowBSearchTool } from '../../knowb-search-tool.js';

type ExecuteFn = (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown>;

// createTool exposes .execute on the returned Tool; in our ai-lib it's named `execute`.
// Fall back to calling the tool as a function for cross-version safety.
function runTool(input: Record<string, unknown>, context?: Record<string, unknown>) {
  const tool = knowBSearchAITool as unknown as { execute?: ExecuteFn };
  if (typeof tool.execute === 'function') return tool.execute(input, context ?? {});
  return (knowBSearchAITool as unknown as ExecuteFn)(input, context ?? {});
}

describe('knowBSearchAITool', () => {
  const toolSearch = knowBSearchTool.search as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toolSearch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a successful single-result response to rank + score.toFixed(4) + message', async () => {
    toolSearch.mockResolvedValueOnce({
      success: true,
      totalResults: 1,
      results: [
        {
          location: { kbNodeId: '/airo_info/deployment.md' },
          content: { text: 'deploy body', type: 'TEXT' },
          score: 0.571837,
        },
      ],
    });

    const out = (await runTool({ query: 'publish my site' }, { metadata: { appId: 'app-1' } })) as Record<string, unknown>;

    expect(out.success).toBe(true);
    expect(out.totalResults).toBe(1);
    expect(out.message).toBe('Found 1 result(s) for query: "publish my site"');
    const results = out.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      rank: 1,
      document: '/airo_info/deployment.md',
      score: '0.5718',
      contentPreview: 'deploy body',
      contentType: 'TEXT',
    });
  });

  it('passes driver error through on success:false', async () => {
    toolSearch.mockResolvedValueOnce({
      success: false,
      error: 'KnowB search failed: network timeout',
    });

    const out = (await runTool({ query: 'anything' })) as Record<string, unknown>;

    expect(out.success).toBe(false);
    expect(out.error).toBe('KnowB search failed: network timeout');
    expect(out.results).toBeUndefined();
  });

  it('does not crash when success:true but results is undefined', async () => {
    toolSearch.mockResolvedValueOnce({
      success: true,
      totalResults: undefined,
      results: undefined,
    });

    const out = (await runTool({ query: 'q' })) as Record<string, unknown>;

    expect(out.success).toBe(true);
    expect(out.totalResults).toBe(0);
    expect(out.results).toEqual([]);
    expect(out.message).toBe('Found 0 result(s) for query: "q"');
  });
});
