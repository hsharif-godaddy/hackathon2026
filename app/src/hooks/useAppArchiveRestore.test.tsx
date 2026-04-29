/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

// Disabled because renderHook() requires hooks to be called inside callbacks
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { LifecycleReason, LifecycleState, SiteStatus } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useAppArchiveRestore } from './useAppArchiveRestore';
import type { AppDetailsResponse } from './useAppDetails';

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

function createRunningAppDetails(): AppDetailsResponse {
  return {
    id: 'test-app-123',
    name: 'Test App',
    status: 'running',
    account_id: 'acc-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: ['preview'],
    variantsWithLifecycle: [{
      variant: 'preview',
      status: 'active',
      lifecycle: {
        lifecycleState: LifecycleState.RUNNING,
        stateChangedAt: new Date().toISOString(),
      },
    }],
  };
}

/**
 * Mirrors the appDetails shape for an app paused due to hibernation, which is the
 * only condition under which the hook may auto-trigger a cold-archive restore.
 */
function createHibernatedAppDetails(): AppDetailsResponse {
  return {
    id: 'test-app-123',
    name: 'Test App',
    status: SiteStatus.Paused,
    account_id: 'acc-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    variants: ['preview'],
    variantsWithLifecycle: [{
      variant: 'preview',
      status: 'active',
      lifecycle: {
        lifecycleState: LifecycleState.PAUSED,
        stateChangedAt: new Date().toISOString(),
        reason: LifecycleReason.HIBERNATION,
      },
    }],
  };
}

function mockArchiveStatusResponse(isArchived: boolean, canRestore = true) {
  return {
    ok: true,
    json: () => Promise.resolve({ isArchived, canRestore }),
  };
}

function mockRestoreResponse(jobId = 'test-job-id') {
  return {
    ok: true,
    status: 202,
    json: () => Promise.resolve({ statusJobId: jobId }),
  };
}

function mockErrorResponse(status = 500, error = 'Server error') {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error }),
  };
}

describe('useAppArchiveRestore', function useAppArchiveRestoreTests() {
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
  });

  afterEach(function cleanup() {
    queryClient.clear();
    vi.clearAllMocks();
  });

  describe('#disabled', function disabledTests() {
    it('should return NOT_ARCHIVED immediately when disabled', function disabledShortCircuit() {
      const { result } = renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      expect(result.current.archiveGatePending).toBe(false);
      expect(result.current.isArchivedForRestore).toBe(false);
      expect(result.current.isRestoringFromArchive).toBe(false);
      expect(result.current.archiveRestoreFailed).toBe(false);
      expect(result.current.archiveRestoreComplete).toBe(false);
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should not fetch archive-status when disabled', async function noFetchWhenDisabled() {
      renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', false),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();
    });
  });

  describe('#archive gate pending', function gatePendingTests() {
    it('should set archiveGatePending true before first archive-status response', async function pendingBeforeFirstFetch() {
      (appFetch as any).mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      expect(result.current.archiveGatePending).toBe(true);
    });

    it('should set archiveGatePending false after archive-status resolves', async function notPendingAfterFetch() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(false));

      const { result } = renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.archiveGatePending).toBe(false);
      });
    });
  });

  describe('#archive detection', function detectionTests() {
    it('should detect archived app and set isArchivedForRestore', async function detectsArchived() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(true, true));

      const { result } = renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', true, false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isArchivedForRestore).toBe(true);
        expect(result.current.archiveGatePending).toBe(false);
      });
    });

    it('should not flag archived when isArchived is false', async function notArchivedWhenFalse() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(false));

      const { result } = renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.archiveGatePending).toBe(false);
        expect(result.current.isArchivedForRestore).toBe(false);
      });

      expect(result.current.isRestoringFromArchive).toBe(false);
      expect(result.current.archiveRestoreFailed).toBe(false);
    });

    it('should not flag archived when canRestore is false', async function notArchivedWhenCannotRestore() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(true, false));

      const { result } = renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.archiveGatePending).toBe(false);
        expect(result.current.isArchivedForRestore).toBe(false);
      });
    });

    it('should return NOT_ARCHIVED on archive-status network failure', async function gracefulOnFetchError() {
      (appFetch as any).mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) });

      const { result } = renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.archiveGatePending).toBe(false);
        expect(result.current.isArchivedForRestore).toBe(false);
        expect(result.current.archiveRestoreFailed).toBe(false);
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'archive.status.initialCheckFailed',
        expect.objectContaining({ appId: 'test-app-123' })
      );
    });

    it('should call archive-status with correct endpoint', async function correctEndpoint() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(false));

      renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/archive-status');
      });
    });

    it('should poll archive-status during active restore while job is in progress', async function pollsArchiveDuringRestore() {
      const fetchSpy = vi.fn(appFetch as any);
      (appFetch as any).mockImplementation(fetchSpy);

      fetchSpy
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse('active-job'))
        .mockReturnValue(new Promise(() => {}));

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('/api/sites/test-app-123/archive-restore', expect.any(Object));
      });

      await new Promise(resolve => setTimeout(resolve, 5500));

      const archiveStatusCalls = fetchSpy.mock.calls.filter(
        call => call[0] === '/api/sites/test-app-123/archive-status'
      );
      expect(archiveStatusCalls.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 10000 });
  });

  describe('#auto-restore', function autoRestoreTests() {
    it('should auto-trigger restore when archived for hibernation and autoRestore is true', async function autoRestoreTrigger() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse());

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/archive-restore',
          expect.objectContaining({ method: 'POST' })
        );
      });
    });

    it('should NOT auto-trigger when archived for a non-hibernation reason', async function noAutoRestoreWhenNotHibernation() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(true));

      const { result } = renderHook(
        () => useAppArchiveRestore(createRunningAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isArchivedForRestore).toBe(true);
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const restoreCalls = (appFetch as any).mock.calls.filter(
        (c: any[]) => c[0] === '/api/sites/test-app-123/archive-restore'
      );
      expect(restoreCalls).toHaveLength(0);
    });

    it('should auto-trigger after appDetails resolves later with hibernation reason', async function autoRestoreAfterAppDetails() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse());

      const { rerender } = renderHook(
        ({ details }: { details: AppDetailsResponse | null }) =>
          useAppArchiveRestore(details, 'test-app-123', true, true),
        {
          wrapper: createWrapper(),
          initialProps: { details: null as AppDetailsResponse | null },
        }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/archive-status');
      });

      const initialRestoreCalls = (appFetch as any).mock.calls.filter(
        (c: any[]) => c[0] === '/api/sites/test-app-123/archive-restore'
      );
      expect(initialRestoreCalls).toHaveLength(0);

      rerender({ details: createHibernatedAppDetails() });

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/archive-restore',
          expect.objectContaining({ method: 'POST' })
        );
      });
    });

    it('should not auto-trigger when autoRestore is false', async function noAutoRestoreWhenDisabled() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(true));

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/sites/test-app-123/archive-status');
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('should not auto-trigger when app is not archived', async function noAutoRestoreWhenNotArchived() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(false));

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(appFetch).toHaveBeenCalledTimes(1));
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('should only auto-trigger once per mount', async function autoRestoreOnlyOnce() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValue(mockRestoreResponse());

      const { rerender } = renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/archive-restore',
          expect.any(Object)
        );
      });

      const callCount = (appFetch as any).mock.calls.filter(
        (c: any[]) => c[0] === '/api/sites/test-app-123/archive-restore'
      ).length;

      rerender();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect((appFetch as any).mock.calls.filter(
        (c: any[]) => c[0] === '/api/sites/test-app-123/archive-restore'
      ).length).toBe(callCount);
    });
  });

  describe('#restore mutation', function restoreMutationTests() {
    it('should set isRestoringFromArchive while waiting for archive to report restored', async function restoringWhileJobPolls() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse('job-1'))
        .mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isRestoringFromArchive).toBe(true);
      });
    });

    it('should call restore endpoint with correct method', async function correctRestoreEndpoint() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse());

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/archive-restore',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });
    });

    it('should set archiveRestoreFailed when restore POST fails', async function failedRestorePost() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockErrorResponse(500, 'Restore failed'));

      const { result } = renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.archiveRestoreFailed).toBe(true);
        expect(result.current.error).toBe('Restore failed');
      });
    });

    it('should start server polling after restore POST succeeds', async function startsPollingOnSuccess() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse())
        .mockReturnValue(new Promise(() => {}));

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockStartPollingForServer).toHaveBeenCalledWith('test-app-123');
      });
    });
  });

  describe('#no job polling', function noJobPollingTests() {
    it('should not call GET /api/jobs after restore', async function doesNotPollJobs() {
      (appFetch as any).mockImplementation((url: string, init?: { method?: string }) => {
        if (url.includes('/archive-status')) {
          return Promise.resolve(mockArchiveStatusResponse(true));
        }
        if (url.includes('/archive-restore') && init?.method === 'POST') {
          return Promise.resolve(mockRestoreResponse());
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      });

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/archive-restore',
          expect.any(Object)
        );
      });

      const jobCalls = (appFetch as any).mock.calls.filter(
        (c: any[]) => String(c[0]).includes('/api/jobs/')
      );
      expect(jobCalls).toHaveLength(0);
    });
  });

  describe('#completion', function completionTests() {
    it('should set archiveRestoreComplete when archive reports restored and app is RUNNING + server ready', async function completesWhenReady() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse())
        .mockResolvedValueOnce(mockArchiveStatusResponse(false, false));

      const { result } = renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(result.current.archiveRestoreComplete).toBe(true);
          expect(result.current.isRestoringFromArchive).toBe(false);
          expect(result.current.archiveRestoreFailed).toBe(false);
        },
        { timeout: 10000 }
      );
    });

    it('should invalidate app-details and archive-status queries on completion', async function invalidatesQueries() {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse())
        .mockResolvedValueOnce(mockArchiveStatusResponse(false, false));

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['app-details', 'test-app-123'] });
          expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['archive-status', 'test-app-123'] });
        },
        { timeout: 10000 }
      );
    });

    it('should also invalidate git-history and deployments on completion', async function invalidatesGitAndDeploy() {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse())
        .mockResolvedValueOnce(mockArchiveStatusResponse(false, false));

      renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['git-history', 'test-app-123'] });
          expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['deployments', 'test-app-123'] });
        },
        { timeout: 10000 }
      );
    });

    it('should only complete once even with rerenders', async function completeOnlyOnce() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse())
        .mockResolvedValueOnce(mockArchiveStatusResponse(false, false));

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { rerender } = renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['app-details', 'test-app-123'] });
        },
        { timeout: 10000 }
      );

      const callCount = invalidateSpy.mock.calls.filter(
        c => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['app-details', 'test-app-123'] })
      ).length;

      rerender();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(
        invalidateSpy.mock.calls.filter(
          c => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['app-details', 'test-app-123'] })
        ).length
      ).toBe(callCount);
    });

    it('should complete when archive-status flips to restored (mgmt job row is not used)', async function archiveStatusDrivesCompletion() {
      let archiveCalls = 0;
      (appFetch as any).mockImplementation((url: string, init?: { method?: string }) => {
        if (url.includes('/archive-status')) {
          archiveCalls += 1;
          if (archiveCalls <= 1) {
            return Promise.resolve(mockArchiveStatusResponse(true));
          }
          return Promise.resolve(mockArchiveStatusResponse(false, false));
        }
        if (url.includes('/archive-restore') && init?.method === 'POST') {
          return Promise.resolve(mockRestoreResponse('stale-queued-job'));
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      });

      const { result } = renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(result.current.archiveRestoreComplete).toBe(true);
        },
        { timeout: 12000 }
      );
    }, 15000);
  });

  describe('#manual restoreFromArchive', function manualRestoreTests() {
    it('should trigger restore on restoreFromArchive call', async function manualTrigger() {
      (appFetch as any)
        .mockResolvedValueOnce(mockArchiveStatusResponse(true))
        .mockResolvedValueOnce(mockRestoreResponse());

      const { result } = renderHook(
        () => useAppArchiveRestore(null, 'test-app-123', true, false),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isArchivedForRestore).toBe(true);
      });

      await act(async () => {
        result.current.restoreFromArchive();
      });

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/sites/test-app-123/archive-restore',
          expect.objectContaining({ method: 'POST' })
        );
      });
    });

    it('should reset error state on manual retry', async function resetOnRetry() {
      (appFetch as any).mockImplementation((url: string, init?: { method?: string }) => {
        if (url.includes('/archive-status')) {
          return Promise.resolve(mockArchiveStatusResponse(true));
        }
        if (url.includes('/archive-restore') && init?.method === 'POST') {
          return Promise.resolve(mockErrorResponse(500, 'First failure'));
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      });

      const { result } = renderHook(
        () => useAppArchiveRestore(createHibernatedAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.archiveRestoreFailed).toBe(true);
      });

      (appFetch as any).mockImplementation((url: string, init?: { method?: string }) => {
        if (url.includes('/archive-status')) {
          return Promise.resolve(mockArchiveStatusResponse(true));
        }
        if (url.includes('/archive-restore') && init?.method === 'POST') {
          return new Promise(() => {});
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      });

      await act(async () => {
        result.current.restoreFromArchive();
      });

      await waitFor(() => {
        expect(result.current.archiveRestoreFailed).toBe(false);
        expect(result.current.isRestoringFromArchive).toBe(true);
      });
    });
  });

  describe('#edge cases', function edgeCaseTests() {
    it('should not fetch when appId is null', async function nullAppId() {
      renderHook(
        () => useAppArchiveRestore(null, null, true),
        { wrapper: createWrapper() }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('should not proceed when app is running and not archived', async function notArchivedRunning() {
      (appFetch as any).mockResolvedValueOnce(mockArchiveStatusResponse(false));

      const { result } = renderHook(
        () => useAppArchiveRestore(createRunningAppDetails(), 'test-app-123', true, true),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.archiveGatePending).toBe(false);
      });

      expect(result.current.isArchivedForRestore).toBe(false);
      expect(result.current.isRestoringFromArchive).toBe(false);
      expect(result.current.archiveRestoreFailed).toBe(false);
      expect(result.current.archiveRestoreComplete).toBe(false);
    });
  });
});
