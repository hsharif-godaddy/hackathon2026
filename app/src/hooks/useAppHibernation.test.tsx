/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

// Disabled because renderHook() requires hooks to be called inside callbacks
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { LifecycleReason, LifecycleState, type SiteVariant } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import type { AppDetailsResponse } from './useAppDetails';
import { useAppHibernation } from './useAppHibernation';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock server state - default to ready
const mockServerState = { isReady: true, url: 'https://test.preview.com' };
const mockStartPollingForServer = vi.fn();

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (state: any) => any) => {
    const servers = new Map();
    servers.set('test-app-123', { server: mockServerState });
    const state = {
      servers,
      startPollingForServer: mockStartPollingForServer,
    };
    return selector(state);
  },
}));

describe('useAppHibernation', function useAppHibernationTests() {
  let queryClient: QueryClient;

  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  function createMockAppDetails(variantsWithLifecycle?: SiteVariant[]): AppDetailsResponse {
    return {
      id: 'test-app-123',
      name: 'Test App',
      status: 'running',
      account_id: 'acc-123',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      variants: ['preview'],
      variantsWithLifecycle,
    };
  }

  function createHibernatedVariant(): SiteVariant[] {
    return [{
      variant: 'preview',
      status: 'paused',
      lifecycle: {
        lifecycleState: LifecycleState.PAUSED,
        reason: LifecycleReason.HIBERNATION,
        stateChangedAt: new Date().toISOString(),
      },
    }];
  }

  function createRunningVariant(): SiteVariant[] {
    return [{
      variant: 'preview',
      status: 'active',
      lifecycle: {
        lifecycleState: LifecycleState.RUNNING,
        reason: LifecycleReason.DEPLOYMENT_COMPLETE,
        stateChangedAt: new Date().toISOString(),
      },
    }];
  }

  beforeEach(function setup() {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    (appFetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: 'Success' }),
    });

    // Reset server state mock
    mockStartPollingForServer.mockClear();
  });

  afterEach(function cleanup() {
    queryClient.clear();
    vi.clearAllMocks();
  });

  describe('#hibernation detection', function detectionTests() {
    it('should detect hibernated preview variant', function detectHibernated() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      expect(result.current.isHibernated).toBe(true);
    });

    it('should not detect paused app without hibernation reason', function detectPausedNotHibernated() {
      const appDetails = createMockAppDetails([{
        variant: 'preview',
        status: 'paused',
        lifecycle: {
          lifecycleState: LifecycleState.PAUSED,
          reason: LifecycleReason.USER_REQUEST,
          stateChangedAt: new Date().toISOString(),
        },
      }]);

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      expect(result.current.isHibernated).toBe(false);
    });

    it('should handle missing variants gracefully', function handleMissingVariants() {
      const appDetails = createMockAppDetails(undefined);

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      expect(result.current.isHibernated).toBe(false);
    });

    it('should handle null appDetails', function handleNullAppDetails() {
      const { result } = renderHook(
        () => useAppHibernation(null, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      expect(result.current.isHibernated).toBe(false);
    });

    it('should short-circuit for non-hibernated apps', function shortCircuit() {
      const appDetails = createMockAppDetails(createRunningVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      expect(result.current.isHibernated).toBe(false);
      expect(result.current.isResuming).toBe(false);
      expect(result.current.resumeFailed).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('#manual resume', function manualResumeTests() {
    it('should call resume API with correct endpoint', async function callResumeApi() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        result.current.resume();
      });

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/resume',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variant: 'preview' }),
          })
        );
      });
    });

    it('should set isResuming to true while resuming', async function setIsResuming() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.resume();
      });

      await waitFor(() => {
        expect(result.current.isResuming).toBe(true);
      });
    });

    it('should handle resume API failure after retries', async function handleApiFailure() {
      (appFetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.resume();
      });

      // Wait for all retries (3 total: 1 initial + 2 retries)
      await waitFor(() => {
        expect(result.current.resumeFailed).toBe(true);
        expect(result.current.error).toBe('Server error');
      }, { timeout: 5000 });
    });

    it('should handle concurrent resume gracefully (409)', async function handleConcurrent() {
      (appFetch as any).mockResolvedValue({
        ok: true,
        status: 409,
        json: () => Promise.resolve({}),
      });

      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        result.current.resume();
      });

      await waitFor(() => {
        expect(result.current.resumeFailed).toBe(false);
      });
    });

    it('should handle missing appId', async function handleMissingAppId() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, null, false),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.resume();
      });

      // Wait for all retries to complete
      await waitFor(() => {
        expect(result.current.resumeFailed).toBe(true);
        expect(result.current.error).toBe('No app ID');
      }, { timeout: 5000 });

      expect(appFetch).not.toHaveBeenCalled();
    });
  });

  describe('#auto-resume', function autoResumeTests() {
    it('should automatically resume when enabled and hibernated', async function autoResume() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/resume',
          expect.any(Object)
        );
      });
    });

    it('should not auto-resume when disabled', async function noAutoResume() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should not auto-resume when not hibernated', async function noAutoResumeWhenRunning() {
      const appDetails = createMockAppDetails(createRunningVariant());

      renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should only auto-resume once per app', async function autoResumeOnce() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { rerender } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledTimes(1);
      });

      // Rerender should not trigger another resume
      rerender();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('#polling', function pollingTests() {
    it('should invalidate app-details query after successful resume', async function invalidateQueries() {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        result.current.resume();
      });

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['app-details', 'test-app-123']
        });
      });
    });
  });

  describe('#suppressForColdArchive', function suppressTests() {
    it('should mask hibernation when suppressForColdArchive is true', function maskHibernation() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false, true),
        { wrapper: createWrapper() }
      );

      expect(result.current.isHibernated).toBe(false);
    });

    it('should not auto-resume when suppressForColdArchive is true', async function noAutoResumeWhenSuppressed() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should not suppress when suppressForColdArchive is false', function noSuppressWhenFalse() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false, false),
        { wrapper: createWrapper() }
      );

      expect(result.current.isHibernated).toBe(true);
    });

    it('should still detect running state when suppressed', function runningDetectedWhenSuppressed() {
      const appDetails = createMockAppDetails(createRunningVariant());

      const { result } = renderHook(
        () => useAppHibernation(appDetails, 'test-app-123', false, true),
        { wrapper: createWrapper() }
      );

      expect(result.current.isHibernated).toBe(false);
      expect(result.current.isResuming).toBe(false);
    });
  });

  describe('#state transitions', function stateTransitionTests() {
    it('should transition from hibernated to running', async function transitionToRunning() {
      const hibernatedDetails = createMockAppDetails(createHibernatedVariant());

      const { result, rerender } = renderHook(
        ({ appDetails }) => useAppHibernation(appDetails, 'test-app-123', false),
        {
          wrapper: createWrapper(),
          initialProps: { appDetails: hibernatedDetails }
        }
      );

      expect(result.current.isHibernated).toBe(true);

      // Simulate resume
      await act(async () => {
        result.current.resume();
      });

      await waitFor(() => {
        expect(result.current.isResuming).toBe(true);
      });

      // Simulate app becoming running
      const runningDetails = createMockAppDetails(createRunningVariant());
      rerender({ appDetails: runningDetails });

      await waitFor(() => {
        expect(result.current.isHibernated).toBe(false);
        expect(result.current.isResuming).toBe(false);
      });
    });

    it('should set resumeComplete when transition finishes', async function setResumeComplete() {
      const hibernatedDetails = createMockAppDetails(createHibernatedVariant());

      const { result, rerender } = renderHook(
        ({ appDetails }) => useAppHibernation(appDetails, 'test-app-123', false),
        {
          wrapper: createWrapper(),
          initialProps: { appDetails: hibernatedDetails }
        }
      );

      expect(result.current.resumeComplete).toBe(false);

      // Trigger resume
      act(() => {
        result.current.resume();
      });

      // Wait for mutation to succeed (isResuming means mutation succeeded)
      await waitFor(() => {
        expect(result.current.isResuming).toBe(true);
      });

      // Simulate app becoming running
      const runningDetails = createMockAppDetails(createRunningVariant());
      rerender({ appDetails: runningDetails });

      await waitFor(() => {
        expect(result.current.resumeComplete).toBe(true);
      });
    });

    it('should reset auto-resume flag when appId changes', async function resetOnAppChange() {
      const appDetails = createMockAppDetails(createHibernatedVariant());

      const { rerender } = renderHook(
        ({ appId }) => useAppHibernation(appDetails, appId, true),
        {
          wrapper: createWrapper(),
          initialProps: { appId: 'app-1' }
        }
      );

      // Wait for auto-resume on first app
      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/app-1/resume',
          expect.any(Object)
        );
      });

      vi.clearAllMocks();

      // Change app - this should allow auto-resume again
      rerender({ appId: 'app-2' });

      // Should auto-resume for new app
      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/app-2/resume',
          expect.any(Object)
        );
      });
    });
  });
});
