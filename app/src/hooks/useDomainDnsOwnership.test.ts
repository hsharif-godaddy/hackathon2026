/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import type { AiroDomainDnsOwnershipResponse } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { renderHookWithProviders } from '@/tests/test-utils';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { domainDnsOwnershipQueryKey, useDomainDnsOwnership } from './useDomainDnsOwnership';

function makeOwnershipResponse(
  overrides: Partial<AiroDomainDnsOwnershipResponse> = {}
): AiroDomainDnsOwnershipResponse {
  return {
    isGdDomain: false,
    isGDDomainOwner: true,
    isGoDaddyDns: false,
    pendingNsPropagation: false,
    domainCreatedAt: null,
    zoneMatchedAt: null,
    nameserverType: 'external',
    nameservers: [],
    dnsApiResponseCode: null,
    domainsApiResponseCode: null,
    ...overrides,
  };
}

describe('useDomainDnsOwnership', function useDomainDnsOwnershipTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('#domainDnsOwnershipQueryKey', function queryKeyTests() {
    it('returns the expected query key tuple', function keyTuple() {
      expect(domainDnsOwnershipQueryKey('site-abc', 'example.com')).toEqual([
        'domain-dns-ownership',
        'site-abc',
        'example.com',
      ]);
    });
  });

  describe('enabled / fetch gating', function gatingTests() {
    it('does not fetch when enabled is false', function disabled() {
      renderHookWithProviders(function useHarnessDisabled() {
        return useDomainDnsOwnership({
          siteId: 'site-1',
          fqdns: 'example.com',
          enabled: false,
        });
      });

      expect(vi.mocked(appFetch)).not.toHaveBeenCalled();
    });

    it('does not fetch when siteId is null', function noSiteId() {
      const { result } = renderHookWithProviders(function useHarnessNoSite() {
        return useDomainDnsOwnership({
          siteId: null,
          fqdns: 'example.com',
          enabled: true,
        });
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(vi.mocked(appFetch)).not.toHaveBeenCalled();
    });

    it('does not fetch when fqdns is null', function noFqdns() {
      const { result } = renderHookWithProviders(function useHarnessNoFqdns() {
        return useDomainDnsOwnership({
          siteId: 'site-1',
          fqdns: null,
          enabled: true,
        });
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(vi.mocked(appFetch)).not.toHaveBeenCalled();
    });
  });

  describe('successful fetch', function successTests() {
    it('fetches successfully and returns data with isGdDomain false', async function successNonGd() {
      const payload = makeOwnershipResponse({ isGdDomain: false });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as Response);

      const { result } = renderHookWithProviders(function useHarnessSuccess() {
        return useDomainDnsOwnership({
          siteId: 'site-1',
          fqdns: 'example.com',
          enabled: true,
        });
      });

      await waitFor(function waitSuccess() {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(payload);
      expect(result.current.data?.isGdDomain).toBe(false);
      expect(vi.mocked(appFetch)).toHaveBeenCalledWith(
        '/api/sites/site-1/domain-dns-ownership?fqdns=example.com',
        { cache: 'no-store' }
      );
    });

    it('fetches successfully with isGdDomain true and returns data', async function successGd() {
      const payload = makeOwnershipResponse({
        isGdDomain: true,
        isGDDomainOwner: true,
        isGoDaddyDns: true,
      });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as Response);

      const { result } = renderHookWithProviders(function useHarnessGd() {
        return useDomainDnsOwnership({
          siteId: 'site-1',
          fqdns: 'shop.example.com',
          enabled: true,
        });
      });

      await waitFor(function waitGdSuccess() {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(payload);
      expect(result.current.data?.isGdDomain).toBe(true);
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
        'domain-dns-ownership-poll.gd-domain',
        expect.objectContaining({ siteId: 'site-1', fqdns: 'shop.example.com' })
      );
    });
  });

  describe('fetch errors', function errorTests() {
    it('handles non-OK response and surfaces error state', async function fetchError() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      } as Response);

      const { result } = renderHookWithProviders(function useHarnessError() {
        return useDomainDnsOwnership({
          siteId: 'site-1',
          fqdns: 'example.com',
          enabled: true,
        });
      });

      await waitFor(
        function waitError() {
          expect(result.current.isError).toBe(true);
        },
        { timeout: 5000 }
      );

      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toBe(
        'Failed to fetch domain DNS ownership: 502'
      );
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        'domain-dns-ownership-poll.fetch-failed',
        expect.objectContaining({
          siteId: 'site-1',
          fqdns: 'example.com',
          status: 502,
        })
      );
    });
  });

  describe('polling timeout', function pollingTimeoutTests() {
    afterEach(function restoreTimers() {
      vi.useRealTimers();
    });

    it('does not trigger further fetches after the 40-minute polling window', async function fortyMinuteCap() {
      vi.useFakeTimers();
      const t0 = 1_700_000_000_000;
      vi.setSystemTime(t0);

      const payload = makeOwnershipResponse();
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as Response);

      renderHookWithProviders(function useHarnessPollingTimeout() {
        return useDomainDnsOwnership({
          siteId: 'site-1',
          fqdns: 'example.com',
          enabled: true,
        });
      });

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(vi.mocked(appFetch)).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(40 * 60 * 1000 + 1);
      });

      const callsAfterFortyMinutes = vi.mocked(appFetch).mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3 * 60_000);
      });

      expect(vi.mocked(appFetch).mock.calls.length).toBe(callsAfterFortyMinutes);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        'domain-dns-ownership-poll.timeout',
        expect.objectContaining({
          siteId: 'site-1',
          fqdns: 'example.com',
        })
      );
    });
  });
});
