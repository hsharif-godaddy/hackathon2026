/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import type { UseAppArchiveRestoreReturn } from './useAppArchiveRestore';
import type { UseAppHibernationReturn } from './useAppHibernation';
import { useImageReadiness } from './useImageReadiness';

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

let mockServerReady = true;
const mockStartPollingForServer = vi.fn();

const mockUseSwitchboard = vi.fn().mockReturnValue(true);
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (...args: any[]) => mockUseSwitchboard(...args),
}));

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (state: any) => any) => {
    const servers = new Map();
    servers.set('test-app-123', { server: { isReady: mockServerReady, url: 'https://test.preview.com' } });
    const state = {
      servers,
      startPollingForServer: mockStartPollingForServer,
    };
    return selector(state);
  },
}));

const NOT_HIBERNATED: UseAppHibernationReturn = {
  isHibernated: false,
  isResuming: false,
  resumeFailed: false,
  resumeComplete: false,
  resume: () => {},
  error: null,
};

const HIBERNATED: UseAppHibernationReturn = {
  isHibernated: true,
  isResuming: true,
  resumeFailed: false,
  resumeComplete: false,
  resume: () => {},
  error: null,
};

const RESUME_FAILED: UseAppHibernationReturn = {
  isHibernated: false,
  isResuming: false,
  resumeFailed: true,
  resumeComplete: false,
  resume: () => {},
  error: 'Resume failed',
};

const ARCHIVE_NOT_RESTORING: UseAppArchiveRestoreReturn = {
  archiveGatePending: false,
  isArchivedForRestore: false,
  isRestoringFromArchive: false,
  archiveRestoreFailed: false,
  archiveRestoreComplete: false,
  restoreFromArchive: () => {},
  error: null,
};

const ARCHIVE_GATE_PENDING: UseAppArchiveRestoreReturn = {
  archiveGatePending: true,
  isArchivedForRestore: false,
  isRestoringFromArchive: false,
  archiveRestoreFailed: false,
  archiveRestoreComplete: false,
  restoreFromArchive: () => {},
  error: null,
};

const ARCHIVE_RESTORING: UseAppArchiveRestoreReturn = {
  archiveGatePending: false,
  isArchivedForRestore: false,
  isRestoringFromArchive: true,
  archiveRestoreFailed: false,
  archiveRestoreComplete: false,
  restoreFromArchive: () => {},
  error: null,
};

const ARCHIVE_DETECTED: UseAppArchiveRestoreReturn = {
  archiveGatePending: false,
  isArchivedForRestore: true,
  isRestoringFromArchive: false,
  archiveRestoreFailed: false,
  archiveRestoreComplete: false,
  restoreFromArchive: () => {},
  error: null,
};

const ARCHIVE_FAILED: UseAppArchiveRestoreReturn = {
  archiveGatePending: false,
  isArchivedForRestore: false,
  isRestoringFromArchive: false,
  archiveRestoreFailed: true,
  archiveRestoreComplete: false,
  restoreFromArchive: () => {},
  error: 'Archive restore failed',
};

function mockImageStatusResponse(status: string) {
  return {
    ok: true,
    json: () => Promise.resolve({
      appId: 'test-app-123',
      compositionId: 'ai-builder',
      compositionVersion: '1.0.0',
      unifiedVariantJob: true,
      status,
    }),
  };
}

function mockReloadResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({
      appId: 'test-app-123',
      status: 'reloading',
      message: 'Reload initiated',
    }),
  };
}

function mockFailedResponse() {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: 'Server error' }),
  };
}

function mock401Response() {
  return {
    ok: false,
    status: 401,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ error: 'Unauthorized' }),
    clone: () => mock401Response(),
  };
}

describe('useImageReadiness', function useImageReadinessTests() {
  let queryClient: QueryClient;

  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  beforeEach(function setup() {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    mockServerReady = true;
    mockStartPollingForServer.mockClear();
    mockUseSwitchboard.mockReturnValue(true);
  });

  afterEach(function cleanup() {
    queryClient.clear();
    vi.clearAllMocks();
  });

  describe('#create flow circuit-break', function createFlowTests() {
    it('should return IMAGES_READY immediately without API calls when isCreateFlow is true', function skipOnCreate() {
      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      expect(result.current.isReady).toBe(true);
      expect(result.current.isChecking).toBe(false);
      expect(result.current.isImageUpdating).toBe(false);
      expect(result.current.error).toBeNull();
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should return IMAGES_READY when isCreateFlow is true even with null appId', function skipOnCreateNullApp() {
      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, null, true),
        { wrapper: createWrapper() }
      );

      expect(result.current.isReady).toBe(true);
      expect(result.current.isChecking).toBe(false);
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should return IMAGES_READY when isCreateFlow is true even during hibernation', function skipOnCreateHibernated() {
      const { result } = renderHook(
        () => useImageReadiness(HIBERNATED, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      expect(result.current.isReady).toBe(true);
      expect(result.current.isChecking).toBe(false);
      expect(result.current.isImageUpdating).toBe(false);
      expect(appFetch).not.toHaveBeenCalled();
    });

    // hasInitialPrompt can transition true → false within a page session: a RESET
    // from useInitialization re-hydrates from sessionStorage, and once the initial
    // prompt is sent the sessionStorage keys are cleared — a subsequent RESET yields
    // hasInitialPrompt=false, resuming normal image readiness checks.
    it('should start normal image check when isCreateFlow transitions from true to false', async function transitionToNormal() {
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { result, rerender } = renderHook(
        ({ createFlow }) => useImageReadiness(NOT_HIBERNATED, 'test-app-123', createFlow),
        {
          wrapper: createWrapper(),
          initialProps: { createFlow: true },
        }
      );

      expect(result.current.isReady).toBe(true);
      expect(appFetch).not.toHaveBeenCalled();

      rerender({ createFlow: false });

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
        expect(result.current.isReady).toBe(true);
      });
    });
  });

  describe('#fast paths', function fastPathTests() {
    it('should short-circuit when status is current', async function shortCircuitCurrent() {
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
        expect(result.current.isImageUpdating).toBe(false);
        expect(result.current.error).toBeNull();
      });

      expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
    });

    it('should short-circuit when status is unknown', async function shortCircuitUnknown() {
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('unknown'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
        expect(result.current.isImageUpdating).toBe(false);
      });
    });

    it('should short-circuit when status is unavailable', async function shortCircuitUnavailable() {
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('unavailable'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
        expect(result.current.isImageUpdating).toBe(false);
      });
    });
  });

  describe('#status check failure', function statusCheckFailureTests() {
    it('should short-circuit gracefully when status check API fails', async function gracefulDegradation() {
      (appFetch as any).mockResolvedValueOnce(mockFailedResponse());

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
        expect(result.current.isImageUpdating).toBe(false);
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe('#stale flow', function staleFlowTests() {
    it('should trigger reload when status is stale', async function triggerReload() {
      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('stale'))
        .mockResolvedValueOnce(mockReloadResponse());

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/reload-images', expect.objectContaining({
          method: 'POST',
        }));
      });

      expect(result.current.isImageUpdating).toBe(true);
    });

    it('should transition to waiting-server when stale reload succeeds and polling finds current', async function staleToServer() {
      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('stale'))
        .mockResolvedValueOnce(mockReloadResponse())
        .mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      // Server polling MUST be started when status flips to 'current' —
      // this is the cutover-completion signal. Asserting this explicitly
      // prevents a silent regression where the call is removed from the
      // poll-result effect (the completion effect would still fire
      // because mockServerReady=true in beforeEach, masking the bug).
      await waitFor(() => {
        expect(mockStartPollingForServer).toHaveBeenCalledWith('test-app-123');
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });
    });

    it('should short-circuit to server wait when reload API fails', async function reloadApiFailure() {
      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('stale'))
        .mockResolvedValueOnce(mockFailedResponse());

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockStartPollingForServer).toHaveBeenCalledWith('test-app-123');
      }, { timeout: 5000 });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });
    });

    it('should not trigger SSO modal for reload 401 (appFetch no longer intercepts)', async function reload401NoSso() {
      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('stale'))
        .mockResolvedValueOnce(mock401Response());

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/reload-images',
          expect.any(Object),
        );
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe('#reloading initial status', function reloadingInitialTests() {
    it('should start polling for server and poll images when initial status is reloading', async function reloadingInitial() {
      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('reloading'))
        .mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockStartPollingForServer).toHaveBeenCalledWith('test-app-123');
      }, { timeout: 5000 });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      }, { timeout: 10000 });
    });

    it('should NOT start polling while phase is polling-images — only after image becomes current', async function pollingGatedOnPollingImages() {
      // Regression guard for the container-cutover bug: during the reload
      // window, two containers serve simultaneously (old being torn down,
      // new starting up). Bootstrapping during this window can hit the OLD
      // container's binary, which may lack the cookie-setting code path.
      // Polling MUST wait until image-status confirms 'current' (cutover
      // complete) before firing.
      //
      // The hook moves to phase 'polling-images' (not 'reloading') when the
      // initial status is reloading — see useImageReadiness.ts where the
      // 'reloading' status check sets setPhase('polling-images'). The gate
      // applies to that phase.
      //
      // After the first reloading response, the hook continues polling
      // image-status every IMAGE_POLL_INTERVAL_MS (5s). Mock the second
      // response too so we can let real time elapse past one poll interval
      // and verify polling was still NOT started — proving the gate holds
      // across multiple poll cycles, not just the first response.
      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('reloading'))
        .mockResolvedValueOnce(mockImageStatusResponse('reloading'));

      renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      // Wait for the initial status check to complete and phase to settle.
      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
      }, { timeout: 5000 });

      // Wait for the second poll to fire (one IMAGE_POLL_INTERVAL_MS = 5s
      // tick) — this proves the gate holds across multiple polls. Without
      // this longer wait, the test only exercises the immediate post-mount
      // path and a regression that started polling on the second poll
      // would slip through.
      await waitFor(() => {
        const statusCalls = vi.mocked(appFetch).mock.calls.filter(
          ([url]) => url === '/api/sites/test-app-123/image-status'
        );
        expect(statusCalls.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 7000 });

      expect(mockStartPollingForServer).not.toHaveBeenCalled();
    }, 10000);
  });

  describe('#hibernation dependency', function hibernationDependencyTests() {
    it('should not start status check while hibernation is in progress', async function gatedByHibernation() {
      const { result } = renderHook(
        () => useImageReadiness(HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(appFetch).not.toHaveBeenCalled();
      expect(result.current.isChecking).toBe(true);
      expect(result.current.isImageUpdating).toBe(false);
      expect(result.current.isReady).toBe(false);
    });

    it('should return IMAGES_READY when hibernation has failed', async function readyOnResumeFailed() {
      const { result } = renderHook(
        () => useImageReadiness(RESUME_FAILED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(appFetch).not.toHaveBeenCalled();
      expect(result.current.isReady).toBe(true);
      expect(result.current.isImageUpdating).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should start status check when hibernation resolves', async function startAfterHibernation() {
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { result, rerender } = renderHook(
        ({ hib }) => useImageReadiness(hib, 'test-app-123'),
        {
          wrapper: createWrapper(),
          initialProps: { hib: HIBERNATED },
        }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();

      rerender({ hib: NOT_HIBERNATED });

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
        expect(result.current.isReady).toBe(true);
      });
    });
  });

  describe('#retry', function retryTests() {
    it('should re-trigger fresh status check when retry is called from error state', async function retryRetriggers() {
      mockServerReady = false;
      let now = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('stale'))
        .mockResolvedValueOnce(mockFailedResponse());

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockStartPollingForServer).toHaveBeenCalledWith('test-app-123');
      }, { timeout: 5000 });

      now += 3 * 60 * 1000 + 1000;

      await waitFor(() => {
        expect(result.current.error).toBe('Server failed to become healthy after image update');
        expect(result.current.isReady).toBe(false);
      }, { timeout: 10000 });

      nowSpy.mockRestore();
      mockServerReady = true;
      vi.mocked(appFetch).mockClear();
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('current'));

      act(() => {
        result.current.retry();
      });

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
        expect(result.current.isReady).toBe(true);
        expect(result.current.error).toBeNull();
      });
    }, 30000);
  });

  describe('#null appId', function nullAppIdTests() {
    it('should handle null appId gracefully', async function handleNullAppId() {
      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, null),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(appFetch).not.toHaveBeenCalled();
      expect(result.current.isChecking).toBe(true);
      expect(result.current.isImageUpdating).toBe(false);
      expect(result.current.isReady).toBe(false);
    });
  });

  describe('#server health wait', function serverHealthTests() {
    it('should complete when server becomes healthy after image is current', async function serverHealthComplete() {
      mockServerReady = true;

      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('stale'))
        .mockResolvedValueOnce(mockReloadResponse())
        .mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
        expect(result.current.isImageUpdating).toBe(false);
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe('#feature flag', function featureFlagTests() {
    it('should short-circuit when feature flag is disabled', async function flagDisabled() {
      mockUseSwitchboard.mockReturnValue(false);

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      expect(result.current.isReady).toBe(true);
      expect(result.current.isImageUpdating).toBe(false);
      expect(result.current.error).toBeNull();
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should short-circuit while feature flag is loading', async function flagLoading() {
      mockUseSwitchboard.mockReturnValue(undefined);

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      expect(result.current.isReady).toBe(true);
      expect(result.current.isImageUpdating).toBe(false);
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should proceed with image check when feature flag is enabled', async function flagEnabled() {
      mockUseSwitchboard.mockReturnValue(true);
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
        expect(result.current.isReady).toBe(true);
      });
    });
  });

  describe('#appId change', function appIdChangeTests() {
    it('should reset state when appId changes', async function resetOnAppChange() {
      (appFetch as any).mockResolvedValue(mockImageStatusResponse('current'));

      const { result, rerender } = renderHook(
        ({ appId }) => useImageReadiness(NOT_HIBERNATED, appId),
        {
          wrapper: createWrapper(),
          initialProps: { appId: 'test-app-123' as string | null },
        }
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      rerender({ appId: 'test-app-456' });

      expect(result.current.isChecking).toBe(true);
      expect(result.current.isImageUpdating).toBe(false);
      expect(result.current.isReady).toBe(false);
    });
  });

  describe('#reloading budget exhausted', function reloadingExhaustedTests() {
    // RELOADING_MAX_POLLS is now sized to match IMAGE_RELOAD_TIMEOUT_MS, so
    // count-based gave-up requires ~18 polls × 5s = 90s of real time —
    // impractical to wait in a unit test. Instead, anchor reloadStartTimeRef
    // (which the hook now sets in the initial-reloading path) and advance
    // Date.now() past the 90s budget. The time-based timed-out fallback
    // fires on the next poll, asserting the same end behavior as the
    // pre-change gave-up test: server polling starts and isReady flips true.
    it('should fall through to server wait once the 90s reload budget is exhausted', async function reloadingBudgetExhausted() {
      let now = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('reloading'))
        .mockResolvedValue(mockImageStatusResponse('reloading'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      // Wait for the initial status check to register so reloadStartTimeRef
      // is set by the hook.
      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
      }, { timeout: 5000 });

      // Advance simulated time past the 90s budget. The next poll's queryFn
      // checks `Date.now() - reloadStartTimeRef.current > 90000` and returns
      // 'timed-out' before count-based gave-up can fire.
      now += 91_000;

      await waitFor(async () => {
        const { logger } = await import('@/lib/request-context');
        expect(logger.warn).toHaveBeenCalledWith(
          'image-readiness.reload.timeout',
          expect.objectContaining({ appId: 'test-app-123' })
        );
      }, { timeout: 10000 });

      // Server polling MUST start when the budget is exhausted so the user
      // gets a recovery path. Without this assertion, silently removing the
      // polling call from the timed-out branch would leave the hook stuck
      // in waiting-server with no live polling.
      await waitFor(() => {
        expect(mockStartPollingForServer).toHaveBeenCalledWith('test-app-123');
      }, { timeout: 5000 });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      }, { timeout: 5000 });

      nowSpy.mockRestore();
    }, 25000);
  });

  describe('#reload 90s timeout', function reloadTimeoutTests() {
    it('should fall through to server wait after 90s reload timeout', async function reloadTimeout() {
      let now = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('stale'))
        .mockResolvedValueOnce(mockReloadResponse())
        .mockResolvedValue(mockImageStatusResponse('reloading'));

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/reload-images', expect.any(Object));
      }, { timeout: 5000 });

      now += 91_000;

      await waitFor(async () => {
        const { logger } = await import('@/lib/request-context');
        expect(logger.warn).toHaveBeenCalledWith(
          'image-readiness.reload.timeout',
          expect.objectContaining({ appId: 'test-app-123' })
        );
      }, { timeout: 10000 });

      // Server polling MUST be started in the timed-out fallback so the
      // user gets a chance to recover after the 90s reload budget is
      // exhausted. Without this assertion, removing the polling call
      // from this branch would silently break recovery (mockServerReady
      // in beforeEach would still produce isReady=true).
      await waitFor(() => {
        expect(mockStartPollingForServer).toHaveBeenCalledWith('test-app-123');
      }, { timeout: 5000 });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      }, { timeout: 5000 });

      nowSpy.mockRestore();
    }, 20000);
  });

  describe('#archive restore gate', function archiveRestoreGateTests() {
    it('should not call image-status API while archiveGatePending is true', async function blockedByGatePending() {
      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123', false, ARCHIVE_GATE_PENDING),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();
      expect(result.current.isReady).toBe(false);
    });

    it('should not call image-status API while isArchivedForRestore is true', async function blockedByArchiveDetected() {
      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123', false, ARCHIVE_DETECTED),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();
      expect(result.current.isReady).toBe(false);
    });

    it('should not call image-status API while isRestoringFromArchive is true', async function blockedByRestoring() {
      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123', false, ARCHIVE_RESTORING),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();
      expect(result.current.isReady).toBe(false);
    });

    it('should proceed and return IMAGES_READY when archiveRestoreFailed is true', async function proceedsOnFailure() {
      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123', false, ARCHIVE_FAILED),
        { wrapper: createWrapper() }
      );

      expect(result.current.isReady).toBe(true);
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should proceed to image-status check when archive restore is not active', async function proceedsWhenNotArchived() {
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('current'));

      renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123', false, ARCHIVE_NOT_RESTORING),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
      });
    });

    it('should resume image checks when archive gate pending transitions to cleared', async function resumesAfterGateClears() {
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { rerender } = renderHook(
        ({ archiveRestore }) => useImageReadiness(NOT_HIBERNATED, 'test-app-123', false, archiveRestore),
        {
          wrapper: createWrapper(),
          initialProps: { archiveRestore: ARCHIVE_GATE_PENDING },
        }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();

      rerender({ archiveRestore: ARCHIVE_NOT_RESTORING });

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
      });
    });

    it('should resume image checks when restore completes (isRestoringFromArchive transitions to false)', async function resumesAfterRestoreCompletes() {
      (appFetch as any).mockResolvedValueOnce(mockImageStatusResponse('current'));

      const { rerender } = renderHook(
        ({ archiveRestore }) => useImageReadiness(NOT_HIBERNATED, 'test-app-123', false, archiveRestore),
        {
          wrapper: createWrapper(),
          initialProps: { archiveRestore: ARCHIVE_RESTORING },
        }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();

      rerender({ archiveRestore: ARCHIVE_NOT_RESTORING });

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/image-status');
      });
    });
  });

  describe('#server health timeout', function serverHealthTimeoutTests() {
    it('should show error after 3-minute server health timeout', async function serverTimeout() {
      mockServerReady = false;
      let now = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

      (appFetch as any)
        .mockResolvedValueOnce(mockImageStatusResponse('stale'))
        .mockResolvedValueOnce(mockFailedResponse());

      const { result } = renderHook(
        () => useImageReadiness(NOT_HIBERNATED, 'test-app-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockStartPollingForServer).toHaveBeenCalledWith('test-app-123');
      }, { timeout: 5000 });

      now += 3 * 60 * 1000 + 1000;

      await waitFor(() => {
        expect(result.current.error).toBe('Server failed to become healthy after image update');
        expect(result.current.isReady).toBe(false);
        expect(result.current.isImageUpdating).toBe(false);
      }, { timeout: 10000 });

      nowSpy.mockRestore();
    }, 30000);
  });
});
