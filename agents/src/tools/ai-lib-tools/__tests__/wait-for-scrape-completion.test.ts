import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RebuildOrchestrationService } from '../../../services/RebuildOrchestrationService.js';
import type { RebuildWorkflowState } from '../../../types/rebuild.js';
import { waitForScrapeCompletion } from '../wait-for-scrape-completion.js';

function baseState(overrides: Partial<RebuildWorkflowState> = {}): RebuildWorkflowState {
  return {
    appId: 'app-123',
    sourceUrl: 'https://example.com',
    rootPath: '/',
    status: 'style_questions',
    scrapingProgress: { total: 5, completed: 1 },
    pagesBuilt: [],
    currentPage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockService(getStatus: ReturnType<typeof vi.fn>): RebuildOrchestrationService {
  return { getStatus } as unknown as RebuildOrchestrationService;
}

describe('waitForScrapeCompletion', function waitForScrapeCompletionTests() {
  beforeEach(function enableFakeTimers() {
    vi.useFakeTimers();
  });

  afterEach(function restoreRealTimers() {
    vi.useRealTimers();
  });

  it('returns immediately when scrape is settled', async function settledImmediately() {
    const getStatus = vi.fn().mockResolvedValue(baseState({ scrapeSettled: true }));
    const pending = waitForScrapeCompletion(mockService(getStatus), 'app-123', 5_000);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(baseState({ scrapeSettled: true }));
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('waits through early style_questions until scrape settles', async function waitsForSettle() {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(baseState())
      .mockResolvedValueOnce(baseState())
      .mockResolvedValue(baseState({ scrapeSettled: true, scrapingProgress: { total: 5, completed: 5 } }));

    const pending = waitForScrapeCompletion(mockService(getStatus), 'app-123', 10_000);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(400);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ scrapeSettled: true });
    expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('throws when workflow enters error', async function workflowError() {
    const getStatus = vi.fn().mockResolvedValue(baseState({
      status: 'error',
      error: 'Scrape failed',
    }));
    await expect(waitForScrapeCompletion(mockService(getStatus), 'app-123', 5_000)).rejects.toThrow('Scrape failed');
  });
});
