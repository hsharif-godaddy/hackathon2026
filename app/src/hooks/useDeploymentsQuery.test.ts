/* eslint-disable react-hooks/rules-of-hooks -- renderHookWithProviders callbacks trigger this rule */
/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';

import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { renderHookWithProviders } from '@/tests/test-utils';

const mockAppFetch = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
  AuthDismissedError: class AuthDismissedError extends Error {
    constructor() { super('Authentication dismissed'); this.name = 'AuthDismissedError'; }
  },
  AuthSessionExpiredError: class AuthSessionExpiredError extends Error {
    constructor() { super('Authentication session expired'); this.name = 'AuthSessionExpiredError'; }
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  logAiroHQEvent: vi.fn(function () { return vi.fn(); }),
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(function () { return false; }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  getSwitchboardFlag: vi.fn(function () { return false; }),
  useSwitchboard: vi.fn(function () { return false; }),
}));

const mockSetDeploymentInProgressId = vi.hoisted(() => vi.fn());
const mockSetFirstPublishDeployPending = vi.hoisted(() => vi.fn());
const mockSetPublishSuccess = vi.hoisted(() => vi.fn());
const mockSetShowFirstPublishCongrats = vi.hoisted(() => vi.fn());
const mockSetShowGoLiveModal = vi.hoisted(() => vi.fn());
const mockGetPublishState = vi.hoisted(() => vi.fn());
const mockHasGoneLive = vi.hoisted(() => vi.fn(function () { return false; }));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn(function (selector: (state: any) => any) {
    const state = {
      getPublishState: mockGetPublishState,
      setDeploymentInProgressId: mockSetDeploymentInProgressId,
      setPublishSuccess: mockSetPublishSuccess,
      setShowFirstPublishCongrats: mockSetShowFirstPublishCongrats,
      setFirstPublishDeployPending: mockSetFirstPublishDeployPending,
      setShowGoLiveModal: mockSetShowGoLiveModal,
      hasGoneLive: mockHasGoneLive,
    };
    return selector(state);
  }),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn(function (selector: (state: any) => any) {
    const state = {
      fetchSite: vi.fn(function () { return Promise.resolve({}); }),
      getSite: vi.fn(function () { return null; }),
    };
    return selector(state);
  }),
}));

import { shipAnalyticsLog } from '@/lib/logging';
import { logImpressionEvent } from '@/utils/instrumentation';
import { useDeploymentsQuery } from './useDeploymentsQuery';

function createMockResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : 'Error',
    json: () => Promise.resolve(data),
  };
}

describe('useDeploymentsQuery', function useDeploymentsQueryTests() {
  beforeEach(function setup() {
    mockGetPublishState.mockReturnValue({
      deploymentInProgressId: null,
      firstPublishDeployPending: false,
    });
    mockAppFetch.mockResolvedValue(createMockResponse([]));
  });

  afterEach(function cleanup() {
    vi.resetAllMocks();
  });

  it('should be defined', function isDefined() {
    expect(useDeploymentsQuery).toBeDefined();
  });

  it('should fetch deployments', async function fetchesDeployments() {
    const deployments = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    mockAppFetch.mockResolvedValue(createMockResponse(deployments));

    const { result } = renderHookWithProviders(() =>
      useDeploymentsQuery({ appId: 'app-123' })
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(deployments);
    });
  });

  describe('poll-count-based timeout', function pollCountTimeoutTests() {
    afterEach(function restoreTimers() {
      vi.useRealTimers();
    });

    it('times out after max poll attempts with non-terminal status', async function timesOutOnStagnation() {
      vi.useFakeTimers();

      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-in-progress',
        firstPublishDeployPending: true,
      });

      const pendingDeployments = [{ id: 'dep-in-progress', status: DeploymentStatus.DEPLOYING }];
      mockAppFetch.mockResolvedValue(createMockResponse(pendingDeployments));

      renderHookWithProviders(() =>
        useDeploymentsQuery({ appId: 'app-123' })
      );

      // Advance enough for max polls: 5s initial + 90*2s fast + 11*10s slow = 295s
      await vi.advanceTimersByTimeAsync(310 * 1000);

      expect(mockSetDeploymentInProgressId).toHaveBeenCalledWith('app-123', null);
      expect(mockSetFirstPublishDeployPending).toHaveBeenCalledWith('app-123', false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'deployments-query.polling.timeout',
        expect.objectContaining({ appId: 'app-123', deploymentId: 'dep-in-progress' })
      );
    });

    it('count only advances on successful fetch responses, not elapsed time', async function countTracksPolls() {
      vi.useFakeTimers();

      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-in-progress',
        firstPublishDeployPending: false,
      });

      const pendingDeployments = [{ id: 'dep-in-progress', status: DeploymentStatus.DEPLOYING }];
      mockAppFetch.mockResolvedValue(createMockResponse(pendingDeployments));

      renderHookWithProviders(() =>
        useDeploymentsQuery({ appId: 'app-123' })
      );

      // Advance 15s: initial 5s delay + ~5 polls at 2s intervals
      await vi.advanceTimersByTimeAsync(15 * 1000);
      const fetchCountAfter15s: number = mockAppFetch.mock.calls.length;

      // Timeout requires 102 poll responses. With only ~5 fetches in 15s,
      // timeout cannot fire regardless of wall-clock elapsed time.
      expect(mockSetDeploymentInProgressId).not.toHaveBeenCalledWith('app-123', null);
      expect(fetchCountAfter15s).toBeGreaterThan(1);
      expect(fetchCountAfter15s).toBeLessThan(102);
    });

    it('resets poll count when deployment reaches terminal state', async function resetsOnSuccess() {
      vi.useFakeTimers();

      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-in-progress',
        firstPublishDeployPending: false,
      });

      const pendingDeployments = [{ id: 'dep-in-progress', status: DeploymentStatus.DEPLOYING }];
      mockAppFetch.mockResolvedValue(createMockResponse(pendingDeployments));

      renderHookWithProviders(() =>
        useDeploymentsQuery({ appId: 'app-123' })
      );

      // Accumulate ~80 polls (enough to blow budget if not reset)
      await vi.advanceTimersByTimeAsync(165 * 1000);

      // Deployment succeeds — refetchInterval resets counter
      const deployedDeployments = [{ id: 'dep-in-progress', status: DeploymentStatus.DEPLOYED }];
      mockAppFetch.mockResolvedValue(createMockResponse(deployedDeployments));
      await vi.advanceTimersByTimeAsync(5 * 1000);

      // Completion effect fires setDeploymentInProgressId(null) — expected
      expect(mockSetDeploymentInProgressId).toHaveBeenCalledWith('app-123', null);
      mockSetDeploymentInProgressId.mockClear();
      mockLogger.warn.mockClear();

      // Start a second deployment — counter must be fresh
      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-second',
        firstPublishDeployPending: false,
      });
      const secondPending = [{ id: 'dep-second', status: DeploymentStatus.DEPLOYING }];
      mockAppFetch.mockResolvedValue(createMockResponse(secondPending));

      // Advance 60s (~30 polls) — well within budget if reset worked
      await vi.advanceTimersByTimeAsync(60 * 1000);

      // If the counter didn't reset, ~80 + 30 = 110 > MAX_POLL_COUNT (102) → timeout
      expect(mockSetDeploymentInProgressId).not.toHaveBeenCalledWith('app-123', null);
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'deployments-query.polling.timeout',
        expect.anything()
      );
    });

    it('times out even when fetch throws persistent network errors', async function networkErrorStillTimesOut() {
      vi.useFakeTimers();

      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-in-progress',
        firstPublishDeployPending: false,
      });

      mockAppFetch.mockRejectedValue(new Error('Network error'));

      renderHookWithProviders(() =>
        useDeploymentsQuery({ appId: 'app-123' })
      );

      // Counter increments in refetchInterval regardless of fetch outcome.
      // Advance enough for 102 interval evaluations to fire timeout.
      await vi.advanceTimersByTimeAsync(310 * 1000);

      expect(mockSetDeploymentInProgressId).toHaveBeenCalledWith('app-123', null);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'deployments-query.polling.timeout',
        expect.objectContaining({ appId: 'app-123', deploymentId: 'dep-in-progress' })
      );
    });
  });

  describe('401 error handling', function authErrorTests() {
    it('should clear deploymentInProgressId on 401 during active polling', async function clearsOnAuth() {
      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-polling',
        firstPublishDeployPending: true,
      });

      mockAppFetch.mockResolvedValue(createMockResponse({}, 401));

      renderHookWithProviders(() =>
        useDeploymentsQuery({ appId: 'app-123' })
      );

      await waitFor(() => {
        expect(mockSetDeploymentInProgressId).toHaveBeenCalledWith('app-123', null);
      });

      expect(mockSetFirstPublishDeployPending).toHaveBeenCalledWith('app-123', false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'deployments-query.fetch.error-during-polling',
        expect.objectContaining({ appId: 'app-123', deploymentId: 'dep-polling', status: 401 })
      );
    });

    it('should not clear state on 401 when no deployment is in progress', async function noOpWithoutPolling() {
      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: null,
        firstPublishDeployPending: false,
      });

      mockAppFetch.mockResolvedValue(createMockResponse({}, 401));

      renderHookWithProviders(() =>
        useDeploymentsQuery({ appId: 'app-123' })
      );

      await waitFor(() => {
        expect(mockAppFetch).toHaveBeenCalled();
      });

      expect(mockSetDeploymentInProgressId).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'deployments-query.fetch.failure',
        expect.anything()
      );
    });

    it('should clear state on 500 during active polling', async function clearsOnServerError() {
      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-polling',
        firstPublishDeployPending: true,
      });

      mockAppFetch.mockResolvedValue(createMockResponse({}, 500));

      renderHookWithProviders(() =>
        useDeploymentsQuery({ appId: 'app-123' })
      );

      await waitFor(() => {
        expect(mockSetDeploymentInProgressId).toHaveBeenCalledWith('app-123', null);
      });

      expect(mockSetFirstPublishDeployPending).toHaveBeenCalledWith('app-123', false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'deployments-query.fetch.error-during-polling',
        expect.objectContaining({ appId: 'app-123', deploymentId: 'dep-polling', status: 500 })
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'deployments-query.fetch.failure',
        expect.objectContaining({ appId: 'app-123' })
      );
    });
  });

  // The retry predicate is the load-bearing fix preventing React Query from
  // re-firing polls while the SSO modal is still open. If a future refactor
  // drops one of the instanceof checks we need a direct test to catch it.
  describe('deployment status analytics', function deploymentStatusAnalyticsTests() {
    it('logs ES and FullStory events when deployment fails', async function publishFailed() {
      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-failed',
        firstPublishDeployPending: true,
      });

      const failedDeployment = {
        id: 'dep-failed',
        status: DeploymentStatus.FAILED,
        gitHash: 'abc123',
        metadata: { errorMessage: 'build timeout' },
      };
      mockAppFetch.mockResolvedValue(createMockResponse([failedDeployment]));

      renderHookWithProviders(() =>
        useDeploymentsQuery({ appId: 'app-123' })
      );

      await waitFor(() => {
        expect(shipAnalyticsLog).toHaveBeenCalledWith('publish.failed', expect.objectContaining({
          appId: 'app-123',
          deploymentId: 'dep-failed',
          commitHash: 'abc123',
          failureReason: 'build timeout',
        }));
      });

      expect(logImpressionEvent).toHaveBeenCalledWith('develop.publish.failed', {
        appId: 'app-123',
        failureReason: 'build timeout',
      });
    });
  });

  describe('retry predicate', function retryPredicateTests() {
    function createRetryPredicateQueryClient() {
      return new QueryClient({
        defaultOptions: {
          queries: { retry: false, retryDelay: 0, gcTime: Infinity },
          mutations: { retry: false },
        },
      });
    }

    it('does not retry when fetch returns 401 (auth flow drives the modal)', async function noRetryOnAuthExpired() {
      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-polling',
        firstPublishDeployPending: true,
      });

      mockAppFetch.mockResolvedValue(createMockResponse({}, 401));

      renderHookWithProviders(
        () => useDeploymentsQuery({ appId: 'app-123' }),
        { queryClient: createRetryPredicateQueryClient() },
      );

      await waitFor(() => {
        expect(mockSetDeploymentInProgressId).toHaveBeenCalledWith('app-123', null);
      });

      // With default retry (3) we'd see 4 calls; with retry: 1 we'd see 2.
      // The predicate short-circuits on AuthSessionExpiredError → exactly 1.
      // Settle pending microtasks before asserting.
      await Promise.resolve();
      expect(mockAppFetch).toHaveBeenCalledTimes(1);
    });

    it('retries exactly once on a generic 500 (predicate falls through to failureCount < 1)', async function retriesOnceOnServerError() {
      mockGetPublishState.mockReturnValue({
        deploymentInProgressId: 'dep-polling',
        firstPublishDeployPending: true,
      });

      mockAppFetch.mockResolvedValue(createMockResponse({}, 500));

      renderHookWithProviders(
        () => useDeploymentsQuery({ appId: 'app-123' }),
        { queryClient: createRetryPredicateQueryClient() },
      );

      await waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalledWith(
          'deployments-query.fetch.failure',
          expect.objectContaining({ appId: 'app-123' })
        );
      });

      // Predicate returns failureCount < 1 → original + one retry = 2 calls.
      await waitFor(() => {
        expect(mockAppFetch).toHaveBeenCalledTimes(2);
      }, { timeout: 3000 });
    });
  });
});
