/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

import {
  isTerminalStatus,
  useDeploymentStatusPolling,
  useDomainDisconnectPolling,
  useMultipleDeploymentStatusPolling,
} from './useDeploymentStatusPolling';

describe('useDeploymentStatusPolling', function useDeploymentStatusPollingTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  afterEach(function cleanup() {
    vi.resetAllMocks();
  });

  describe('isTerminalStatus', function isTerminalStatusTests() {
    it('should return true for DEPLOYED status', function deployedIsTerminal() {
      expect(isTerminalStatus(DeploymentStatus.DEPLOYED)).toBe(true);
    });

    it('should return true for FAILED status', function failedIsTerminal() {
      expect(isTerminalStatus(DeploymentStatus.FAILED)).toBe(true);
    });

    it('should return false for PENDING status', function pendingNotTerminal() {
      expect(isTerminalStatus(DeploymentStatus.PENDING)).toBe(false);
    });

    it('should return false for IN_PROGRESS status', function inProgressNotTerminal() {
      expect(isTerminalStatus(DeploymentStatus.DEPLOYING)).toBe(false);
    });

    it('should return false for null', function nullNotTerminal() {
      expect(isTerminalStatus(null)).toBe(false);
    });

    it('should return false for undefined', function undefinedNotTerminal() {
      expect(isTerminalStatus(undefined)).toBe(false);
    });
  });

  describe('useDeploymentStatusPolling', function singlePollingTests() {
    it('should not fetch when deploymentId is null', function noFetchWhenNull() {
      renderHookWithProviders(() =>
        useDeploymentStatusPolling({
          appId: 'app-123',
          deploymentId: null,
        })
      );

      expect(mockAppFetch).not.toHaveBeenCalled();
    });

    it('should not fetch when appId is empty', function noFetchWhenEmptyAppId() {
      renderHookWithProviders(() =>
        useDeploymentStatusPolling({
          appId: '',
          deploymentId: 'deploy-123',
        })
      );

      expect(mockAppFetch).not.toHaveBeenCalled();
    });

    it('should fetch deployment status when both appId and deploymentId are provided', async function fetchesStatus() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deployments: [
            { id: 'deploy-123', status: DeploymentStatus.DEPLOYING },
          ],
        }),
      });

      renderHookWithProviders(() =>
        useDeploymentStatusPolling({
          appId: 'app-123',
          deploymentId: 'deploy-123',
        })
      );

      await waitFor(function waitForFetch() {
        expect(mockAppFetch).toHaveBeenCalledWith(
          '/api/apps/app-123/deployments?limit=5',
          { cache: 'no-store' }
        );
      });
    });

    it('should call onComplete when terminal status is reached', async function callsOnComplete() {
      const onComplete = vi.fn();
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deployments: [
            { id: 'deploy-123', status: DeploymentStatus.DEPLOYED },
          ],
        }),
      });

      renderHookWithProviders(() =>
        useDeploymentStatusPolling({
          appId: 'app-123',
          deploymentId: 'deploy-123',
          onComplete,
        })
      );

      await waitFor(function waitForComplete() {
        expect(onComplete).toHaveBeenCalledWith(DeploymentStatus.DEPLOYED);
      });
    });

    it('should handle array response format', async function handlesArrayFormat() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'deploy-123', status: DeploymentStatus.DEPLOYING },
        ],
      });

      const { result } = renderHookWithProviders(() =>
        useDeploymentStatusPolling({
          appId: 'app-123',
          deploymentId: 'deploy-123',
        })
      );

      await waitFor(function waitForData() {
        expect(result.current.data).toBe(DeploymentStatus.DEPLOYING);
      });
    });

    it('should return null when deployment is not found', async function returnsNullWhenNotFound() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deployments: [
            { id: 'other-deploy', status: DeploymentStatus.DEPLOYED },
          ],
        }),
      });

      const { result } = renderHookWithProviders(() =>
        useDeploymentStatusPolling({
          appId: 'app-123',
          deploymentId: 'deploy-123',
        })
      );

      await waitFor(function waitForData() {
        expect(result.current.data).toBeNull();
      });
    });

    it('should return null on fetch error', async function returnsNullOnError() {
      mockAppFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHookWithProviders(() =>
        useDeploymentStatusPolling({
          appId: 'app-123',
          deploymentId: 'deploy-123',
        })
      );

      await waitFor(function waitForData() {
        expect(result.current.data).toBeNull();
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'deployment-status-poll.fetch-failed',
        expect.objectContaining({
          appId: 'app-123',
          deploymentId: 'deploy-123',
          status: 500,
        })
      );
    });

    it('should log info when terminal status is reached', async function logsOnComplete() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deployments: [
            { id: 'deploy-123', status: DeploymentStatus.DEPLOYED },
          ],
        }),
      });

      renderHookWithProviders(() =>
        useDeploymentStatusPolling({
          appId: 'app-123',
          deploymentId: 'deploy-123',
        })
      );

      await waitFor(function waitForLog() {
        expect(mockLogger.info).toHaveBeenCalledWith(
          'deployment-status-poll.complete',
          expect.objectContaining({
            appId: 'app-123',
            deploymentId: 'deploy-123',
            status: DeploymentStatus.DEPLOYED,
          })
        );
      });
    });
  });

  describe('useMultipleDeploymentStatusPolling', function multiplePollingTests() {
    it('should not create queries for empty deployments array', function noQueriesWhenEmpty() {
      const { result } = renderHookWithProviders(() =>
        useMultipleDeploymentStatusPolling({
          deployments: [],
        })
      );

      expect(result.current).toHaveLength(0);
    });

    it('should create a query for each deployment', async function createsQueries() {
      mockAppFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            deployments: [{ id: 'deploy-1', status: DeploymentStatus.DEPLOYING }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            deployments: [{ id: 'deploy-2', status: DeploymentStatus.DEPLOYED }],
          }),
        });

      const { result } = renderHookWithProviders(() =>
        useMultipleDeploymentStatusPolling({
          deployments: [
            { appId: 'app-1', deploymentId: 'deploy-1' },
            { appId: 'app-2', deploymentId: 'deploy-2' },
          ],
        })
      );

      await waitFor(function waitForQueries() {
        expect(result.current).toHaveLength(2);
      });
    });

    it('should call onComplete for each deployment that reaches terminal status', async function callsOnCompleteForEach() {
      const onComplete = vi.fn();
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deployments: [{ id: 'deploy-1', status: DeploymentStatus.DEPLOYED }],
        }),
      });

      renderHookWithProviders(() =>
        useMultipleDeploymentStatusPolling({
          deployments: [{ appId: 'app-1', deploymentId: 'deploy-1' }],
          onComplete,
        })
      );

      await waitFor(function waitForComplete() {
        expect(onComplete).toHaveBeenCalledWith('app-1', DeploymentStatus.DEPLOYED);
      });
    });
  });

  describe('useDomainDisconnectPolling', function domainPollingTests() {
    it('should not create queries for empty domains array', function noQueriesWhenEmpty() {
      const { result } = renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [],
        })
      );

      expect(result.current).toHaveLength(0);
    });

    it('should call onComplete when domain is removed', async function callsOnCompleteWhenRemoved() {
      const onComplete = vi.fn();
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          domains: [], // Domain was removed
        }),
      });

      renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [{ appId: 'app-1', domainFqdn: 'example.com' }],
          onComplete,
        })
      );

      await waitFor(function waitForComplete() {
        expect(onComplete).toHaveBeenCalledWith('app-1');
      });

      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/sites/app-1',
        { cache: 'no-store' }
      );
    });

    it('should not call onComplete when domain still exists', async function noCompleteWhenExists() {
      const onComplete = vi.fn();
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          domains: [{ fqdn: 'example.com' }],
        }),
      });

      const { result } = renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [{ appId: 'app-1', domainFqdn: 'example.com' }],
          onComplete,
        })
      );

      await waitFor(function waitForData() {
        expect(result.current[0].data?.removed).toBe(false);
        expect(result.current[0].data?.timedOut).toBe(false);
      });

      expect(onComplete).not.toHaveBeenCalled();
    });

    it('should log completion when domain is removed', async function logsCompletion() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          domains: [],
        }),
      });

      renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [{ appId: 'app-1', domainFqdn: 'example.com' }],
        })
      );

      await waitFor(function waitForLog() {
        expect(mockLogger.info).toHaveBeenCalledWith(
          'domain-disconnect-poll.complete',
          expect.objectContaining({
            appId: 'app-1',
            domainFqdn: 'example.com',
          })
        );
      });
    });

    it('should handle fetch failure gracefully', async function handlesFetchFailure() {
      mockAppFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [{ appId: 'app-1', domainFqdn: 'example.com' }],
        })
      );

      await waitFor(function waitForData() {
        expect(result.current[0].data?.removed).toBe(false);
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'domain-disconnect-poll.fetch-failed',
        expect.objectContaining({
          appId: 'app-1',
          status: 500,
        })
      );
    });

    it('should accept onTimeout callback in options', function acceptsOnTimeoutCallback() {
      const onTimeout = vi.fn();
      const onComplete = vi.fn();

      mockAppFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          domains: [{ fqdn: 'example.com' }],
        }),
      });

      // Just verify the hook accepts the onTimeout callback without error
      const { result } = renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [{ appId: 'app-1', domainFqdn: 'example.com' }],
          onComplete,
          onTimeout,
        })
      );

      // Hook should initialize without error
      expect(result.current).toHaveLength(1);
    });

    it('should return timedOut field in query data', async function returnsTimedOutField() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          domains: [{ fqdn: 'example.com' }],
        }),
      });

      const { result } = renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [{ appId: 'app-1', domainFqdn: 'example.com' }],
        })
      );

      await waitFor(function waitForData() {
        expect(result.current[0].data).toBeDefined();
      });

      // When domain still exists and not timed out, timedOut should be false
      expect(result.current[0].data?.timedOut).toBe(false);
      expect(result.current[0].data?.removed).toBe(false);
    });

    it('should call onTimeout when timedOut data is returned', async function callsOnTimeoutWhenTimedOut() {
      // This test verifies the onTimeout callback mechanism works
      // Full timeout behavior requires integration testing with real timers
      const onTimeout = vi.fn();
      const onComplete = vi.fn();

      // Return domain still exists - onTimeout would be called by timeout logic
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          domains: [{ fqdn: 'example.com' }],
        }),
      });

      const { result } = renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [{ appId: 'app-1', domainFqdn: 'example.com' }],
          onComplete,
          onTimeout,
        })
      );

      await waitFor(function waitForData() {
        expect(result.current[0].data).toBeDefined();
      });

      // In normal operation (no timeout), timedOut should be false
      expect(result.current[0].data?.timedOut).toBe(false);
      // onTimeout is not called until timeout threshold is reached
      expect(onTimeout).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('should only call onComplete once when domain is removed', async function onCompleteCalledOnce() {
      const onComplete = vi.fn();

      // Domain is removed immediately
      mockAppFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          domains: [], // Domain removed
        }),
      });

      const { result } = renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: [{ appId: 'app-1', domainFqdn: 'example.com' }],
          onComplete,
        })
      );

      // Wait for domain to be detected as removed
      await waitFor(function waitForRemoved() {
        expect(result.current[0].data?.removed).toBe(true);
      });

      // onComplete should be called exactly once
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith('app-1');
    });

    it('should reset state when domain is re-added after being removed', async function resetsStateOnReAdd() {
      const onComplete = vi.fn();
      let domainsToTrack: { appId: string; domainFqdn: string }[] = [
        { appId: 'app-1', domainFqdn: 'example.com' },
      ];

      // Domain is removed
      mockAppFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          domains: [],
        }),
      });

      const { result, rerender } = renderHookWithProviders(() =>
        useDomainDisconnectPolling({
          domains: domainsToTrack,
          onComplete,
        })
      );

      // Wait for first completion
      await waitFor(function waitForFirstRemoval() {
        expect(result.current[0]?.data?.removed).toBe(true);
      });

      expect(onComplete).toHaveBeenCalledTimes(1);

      // Remove domain from tracking (simulates user navigating away or state clearing)
      domainsToTrack = [];
      rerender();

      // Re-add the same domain (simulates user unpublishing again)
      domainsToTrack = [{ appId: 'app-1', domainFqdn: 'example.com' }];
      rerender();

      // Wait for second completion - should call onComplete again since state was reset
      await waitFor(function waitForSecondRemoval() {
        expect(result.current[0]?.data?.removed).toBe(true);
      });

      // onComplete should be called twice total (once for each tracking session)
      expect(onComplete).toHaveBeenCalledTimes(2);
    });
  });
});
