/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-hooks/rules-of-hooks */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useSeoQualityCheck } from './useSeoQualityCheck';

const mockGetConfigForSite = vi.fn();
const mockAgentFetch = vi.fn();
const mockSetSeoRegressionAlert = vi.fn();
const mockLogImpressionEvent = vi.fn(() => vi.fn());
const mockFetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: (...args: unknown[]) => mockGetConfigForSite(...args),
  },
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: { setSeoRegressionAlert: typeof mockSetSeoRegressionAlert }) => unknown) =>
    selector({ setSeoRegressionAlert: mockSetSeoRegressionAlert }),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (...args: unknown[]) => mockLogImpressionEvent(...args),
}));

const APP_ID = 'testapp001';
const AGENT_URL = 'https://agent.test';

function makeResponse(data: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(data) } as Response;
}

describe('useSeoQualityCheck', function useSeoQualityCheckTests() {
  beforeEach(function setup() {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
    mockGetConfigForSite.mockResolvedValue({ agentUrl: AGENT_URL });
    mockAgentFetch.mockResolvedValue(makeResponse({ latest: null }));
    mockSetSeoRegressionAlert.mockReset();
    mockLogImpressionEvent.mockReset();
    mockLogImpressionEvent.mockReturnValue(vi.fn());
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not fetch without a publish-snapshot-request event', async function noFetchWithoutEvent() {
    renderHookWithProviders(() => useSeoQualityCheck(APP_ID));

    await act(async function advance() { vi.advanceTimersByTime(6000); });

    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('does nothing when appId is null', async function nullAppId() {
    renderHookWithProviders(() => useSeoQualityCheck(null));

    act(function fireEvent() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: APP_ID } }));
    });
    await act(async function advance() { vi.advanceTimersByTime(6000); });

    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('fetches after 6-second delay when event fires for matching appId', async function fetchAfterDelay() {
    renderHookWithProviders(() => useSeoQualityCheck(APP_ID));

    act(function fireEvent() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: APP_ID } }));
    });
    expect(mockAgentFetch).not.toHaveBeenCalled();

    await act(async function advance() { vi.advanceTimersByTime(6000); });

    expect(mockAgentFetch).toHaveBeenCalledWith(
      `${AGENT_URL}/apps/${APP_ID}/seo-quality/latest`,
      { siteId: APP_ID },
    );
  });

  it('ignores publish-snapshot-request for a different appId', async function differentAppId() {
    renderHookWithProviders(() => useSeoQualityCheck(APP_ID));

    act(function fireEvent() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: 'other-app1' } }));
    });
    await act(async function advance() { vi.advanceTimersByTime(6000); });

    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it('fires seo.quality.baseline and does not set alert on first publish', async function baselineNoAlert() {
    mockAgentFetch.mockResolvedValue(makeResponse({
      latest: {
        id: 'snap-1',
        score: 75,
        pageScores: { '/': 75 },
        missingElements: { '/': ['missing-og-title'] },
        isBaseline: true,
        triggeredBy: 'publish',
        createdAt: '2026-06-15T07:00:00.000Z',
      },
      baseline: { id: 'b1', score: 75 },
      regression: null,
    }));
    renderHookWithProviders(() => useSeoQualityCheck(APP_ID));

    act(function fireEvent() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: APP_ID } }));
    });
    await act(async function advance() { vi.advanceTimersByTime(6000); });

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('seo.quality.baseline', {
      id: 'snap-1',
      score: 75,
      pageScores: JSON.stringify({ '/': 75 }),
      missingElements: JSON.stringify({ '/': ['missing-og-title'] }),
      triggeredBy: 'publish',
      createdAt: '2026-06-15T07:00:00.000Z',
    });
    expect(mockSetSeoRegressionAlert).not.toHaveBeenCalled();
  });

  it('fires seo.quality.snapshot and does not set alert when no regression', async function snapshotNoRegression() {
    mockAgentFetch.mockResolvedValue(makeResponse({
      latest: {
        id: 'snap-2',
        score: 70,
        pageScores: { '/': 70 },
        missingElements: { '/': ['missing-og-title'] },
        isBaseline: false,
        triggeredBy: 'publish',
        createdAt: '2026-06-15T07:05:00.000Z',
      },
      baseline: { id: 'b1', score: 75 },
      regression: { isRegression: false, scoreDelta: -5, regressions: [] },
    }));
    renderHookWithProviders(() => useSeoQualityCheck(APP_ID));

    act(function fireEvent() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: APP_ID } }));
    });
    await act(async function advance() { vi.advanceTimersByTime(6000); });

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('seo.quality.snapshot', {
      id: 'snap-2',
      score: 70,
      pageScores: JSON.stringify({ '/': 70 }),
      missingElements: JSON.stringify({ '/': ['missing-og-title'] }),
      triggeredBy: 'publish',
      createdAt: '2026-06-15T07:05:00.000Z',
      isRegression: false,
      scoreDelta: -5,
      affectedPages: 0,
    });
    expect(mockSetSeoRegressionAlert).not.toHaveBeenCalled();
  });

  it('fires snapshot + regression impressions and sets alert on regression', async function regressionSetsAlert() {
    const regressions = [{ path: '/about', newIssues: ['missing-title'] }];
    mockAgentFetch.mockResolvedValue(makeResponse({
      latest: {
        id: 'snap-3',
        score: 40,
        pageScores: { '/about': 40 },
        missingElements: { '/about': ['missing-title'] },
        isBaseline: false,
        triggeredBy: 'publish',
        createdAt: '2026-06-15T07:10:00.000Z',
      },
      baseline: { id: 'b1', score: 80 },
      regression: { isRegression: true, scoreDelta: -40, regressions },
    }));
    renderHookWithProviders(() => useSeoQualityCheck(APP_ID));

    act(function fireEvent() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: APP_ID } }));
    });
    await act(async function advance() { vi.advanceTimersByTime(6000); });

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('seo.quality.snapshot', {
      id: 'snap-3',
      score: 40,
      pageScores: JSON.stringify({ '/about': 40 }),
      missingElements: JSON.stringify({ '/about': ['missing-title'] }),
      triggeredBy: 'publish',
      createdAt: '2026-06-15T07:10:00.000Z',
      isRegression: true,
      scoreDelta: -40,
      affectedPages: 1,
    });
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('seo.quality.regression', {
      id: 'snap-3',
      score: 40,
      pageScores: JSON.stringify({ '/about': 40 }),
      missingElements: JSON.stringify({ '/about': ['missing-title'] }),
      triggeredBy: 'publish',
      createdAt: '2026-06-15T07:10:00.000Z',
      scoreDelta: -40,
      affectedPages: 1,
    });
    expect(mockSetSeoRegressionAlert).toHaveBeenCalledWith(APP_ID, {
      scoreDelta: -40,
      currentScore: 40,
      regressions,
    });
  });

  it('cancels a pending fetch when a second publish event arrives', async function cancelsOnRePublish() {
    renderHookWithProviders(() => useSeoQualityCheck(APP_ID));

    act(function firstPublish() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: APP_ID } }));
    });
    act(function advancePartially() { vi.advanceTimersByTime(2000); });

    act(function secondPublish() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: APP_ID } }));
    });

    // First timeout would have fired here — should have been cancelled
    await act(async function advancePastFirst() { vi.advanceTimersByTime(4500); });
    expect(mockAgentFetch).not.toHaveBeenCalled();

    // Second timeout fires
    await act(async function advancePastSecond() { vi.advanceTimersByTime(2000); });
    expect(mockAgentFetch).toHaveBeenCalledTimes(1);
  });

  it('cleans up event listener and pending timeout on unmount', async function cleanupOnUnmount() {
    const { unmount } = renderHookWithProviders(() => useSeoQualityCheck(APP_ID));

    act(function fireEvent() {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId: APP_ID } }));
    });
    unmount();

    await act(async function advance() { vi.advanceTimersByTime(10000); });
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });
});
