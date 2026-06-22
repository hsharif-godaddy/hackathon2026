/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';

const mockAgentFetch = vi.hoisted(() => vi.fn());
const mockBuildDynamicAgentUrl = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}));

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: (...args: unknown[]) => mockBuildDynamicAgentUrl(...args),
}));

import {
  useRebuildScopeEstimates,
  useRebuildWorkflowStatus,
  useSubmitRebuildIntake,
} from './useRebuildIntake';

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

describe('useRebuildIntake', () => {
  beforeEach(() => {
    mockBuildDynamicAgentUrl.mockImplementation(async (path: string) => `https://agent/${path}`);
    mockAgentFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('useRebuildWorkflowStatus', () => {
    it('returns null when status endpoint responds 404', async function status404() {
      mockAgentFetch.mockResolvedValue(mockResponse({}, 404));

      const { result } = renderHookWithProviders(() =>
        useRebuildWorkflowStatus('app-abc', true),
      );

      await waitFor(() => {
        expect(result.current.data).toBeNull();
      });
      expect(mockAgentFetch).toHaveBeenCalled();
    });

    it('stops polling on hard error', async function stopOnError() {
      mockAgentFetch.mockResolvedValue(mockResponse({}, 500));

      renderHookWithProviders(() => useRebuildWorkflowStatus('app-abc', true));

      await waitFor(() => {
        expect(mockAgentFetch).toHaveBeenCalled();
      });

      const callsAfterError = mockAgentFetch.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 1_500));
      expect(mockAgentFetch.mock.calls.length).toBe(callsAfterError);
    });

    it('stops polling when intakeCompleted', async function stopPolling() {
      mockAgentFetch.mockResolvedValue(
        mockResponse({
          status: 'scraping',
          sourceUrl: 'https://example.com',
          intakeCompleted: true,
          scrapingProgress: { total: 1, completed: 0 },
          hasStylePreferences: false,
        }),
      );

      renderHookWithProviders(() => useRebuildWorkflowStatus('app-abc', true));

      await waitFor(() => {
        expect(mockAgentFetch).toHaveBeenCalled();
      });

      const callsAfterLoad = mockAgentFetch.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 1_500));
      expect(mockAgentFetch.mock.calls.length).toBe(callsAfterLoad);
    });
  });

  describe('useSubmitRebuildIntake', () => {
    it('posts scope and design direction to intake endpoint', async function submitIntake() {
      mockAgentFetch.mockResolvedValue(
        mockResponse({ status: 'scraping', intakeCompleted: true }),
      );

      const { result } = renderHookWithProviders(() => useSubmitRebuildIntake('app-abc'));

      await result.current.mutateAsync({
        scope: 'small',
        designDirection: 'modernize',
      });

      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith(
        'apps/app-abc/rebuild/intake',
        'app-abc',
      );
      expect(mockAgentFetch).toHaveBeenCalledWith(
        'https://agent/apps/app-abc/rebuild/intake',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            scope: 'small',
            stylePreferences: {
              designDirection: 'modernize',
              colorPreference: 'keep-original',
              typographyStyle: 'keep-original',
              layoutApproach: 'responsive',
              keepLogo: true,
              keepSourceImages: false,
            },
          }),
        }),
      );
    });

    it('surfaces API error message on failure', async function submitError() {
      mockAgentFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'Cannot submit intake while status is scraping' }),
      });

      const { result } = renderHookWithProviders(() => useSubmitRebuildIntake('app-abc'));

      await expect(
        result.current.mutateAsync({ scope: 'homepage_only', designDirection: 'keep-similar' }),
      ).rejects.toThrow('Cannot submit intake while status is scraping');
    });
  });

  describe('useRebuildScopeEstimates', () => {
    it('fetches scope estimates from agents API', async function fetchEstimates() {
      const estimates = [
        { scope: 'homepage_only', labelKey: 'builder_rebuild_intake_scope_homepage_label' },
      ];
      mockAgentFetch.mockResolvedValue(mockResponse({ estimates }));

      const { result } = renderHookWithProviders(() => useRebuildScopeEstimates('app-abc'));

      await waitFor(() => {
        expect(result.current.data).toEqual(estimates);
      });
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith(
        'apps/app-abc/rebuild/scope-estimates',
        'app-abc',
      );
    });
  });
});
