import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../tools/ai-lib-tools/drivers/knowb-driver.js', () => {
  const search = vi.fn();
  const formatResultsAsMarkdown = vi.fn((items: unknown[]) =>
    (items as Array<{ kbNodeId: string }>).map((i) => `## ${i.kbNodeId}`).join('\n---\n'),
  );
  return {
    knowBDriver: { search, formatResultsAsMarkdown },
    KnowBDriver: class {},
  };
});

vi.mock('@langfuse/tracing', () => ({
  observe: (fn: unknown) => fn,
  updateActiveObservation: vi.fn(),
}));

import { buildRagContextMessage } from '../context-builders.js';
import { knowBDriver } from '../../tools/ai-lib-tools/drivers/knowb-driver.js';

describe('buildRagContextMessage', () => {
  const driverSearch = knowBDriver.search as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    driverSearch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when userMessage is empty or whitespace-only', async () => {
    expect(await buildRagContextMessage({ userMessage: '' })).toBeNull();
    expect(await buildRagContextMessage({ userMessage: '   \n\t  ' })).toBeNull();
    expect(driverSearch).not.toHaveBeenCalled();
  });

  it('returns null and does not throw when driver reports success:false', async () => {
    driverSearch.mockResolvedValueOnce({
      success: false,
      error: 'No authentication configured',
    });

    const result = await buildRagContextMessage({
      userMessage: 'publish my site',
      appId: 'app-1',
      sessionId: 'sess-1',
    });

    expect(result).toBeNull();
    expect(driverSearch).toHaveBeenCalledTimes(1);
  });

  it('returns null when driver succeeds with zero results', async () => {
    driverSearch.mockResolvedValueOnce({ success: true, results: [] });

    const result = await buildRagContextMessage({ userMessage: 'hello' });

    expect(result).toBeNull();
  });

  it('returns a context message when driver returns results', async () => {
    driverSearch.mockResolvedValueOnce({
      success: true,
      results: [
        { kbNodeId: '/airo_info/deployment', text: 'body', score: 0.57 },
      ],
    });

    const result = await buildRagContextMessage({
      userMessage: 'how do i deploy',
      appId: 'app-1',
    });

    expect(result).not.toBeNull();
    expect(result!.role).toBe('user');
    expect(result!.insertionOrder).toBe('after_history');
    expect(result!.content).toContain('Relevant Documentation');
    expect(result!.content).toContain('/airo_info/deployment');
  });
});
