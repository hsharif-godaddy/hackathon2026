/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { renderHookWithProviders } from '@/tests/test-utils';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useDomainConflictCheck } from './useDomainConflictCheck';

function mockResponse(body: object, ok = true): void {
  (appFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
}

describe('useDomainConflictCheck', function conflictCheckTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('disabled states', function disabledTests() {
    it('does not fetch when enabled is false', function noFetchDisabled() {
      renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', false),
      );
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('does not fetch when appId is null', function noFetchNullAppId() {
      renderHookWithProviders(() =>
        useDomainConflictCheck(null, 'example.com', '1.2.3.4', true),
      );
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('does not fetch when fqdn is null', function noFetchNullFqdn() {
      renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', null, '1.2.3.4', true),
      );
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('returns hasDnsDrift false when not enabled', function falseWhenDisabled() {
      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', false),
      );
      expect(result.current.hasDnsDrift).toBe(false);
    });
  });

  describe('anycastIp comparison (primary path)', function anycastTests() {
    it('returns false when currentIps includes anycastIp', async function noConflict() {
      mockResponse({ hasProductDNSConflict: false, currentIps: ['1.2.3.4', '5.6.7.8'], failedOpen: false });

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', true),
      );

      await waitFor(() => expect(appFetch).toHaveBeenCalled());
      expect(result.current.hasDnsDrift).toBe(false);
    });

    it('returns true when currentIps does not include anycastIp', async function driftDetected() {
      mockResponse({ hasProductDNSConflict: false, currentIps: ['9.9.9.9'], failedOpen: false });

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', true),
      );

      await waitFor(() => expect(result.current.hasDnsDrift).toBe(true));
    });

    it('returns true when currentIps is empty', async function emptyIps() {
      mockResponse({ hasProductDNSConflict: false, currentIps: [], failedOpen: false });

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', true),
      );

      await waitFor(() => expect(result.current.hasDnsDrift).toBe(true));
    });
  });

  describe('fallback to hasProductDNSConflict', function fallbackTests() {
    it('uses hasProductDNSConflict when anycastIp is absent', async function noAnycast() {
      mockResponse({ hasProductDNSConflict: true, currentIps: ['9.9.9.9'], failedOpen: false });

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', undefined, true),
      );

      await waitFor(() => expect(result.current.hasDnsDrift).toBe(true));
    });

    it('uses hasProductDNSConflict when currentIps is null', async function nullIps() {
      mockResponse({ hasProductDNSConflict: true, currentIps: null, failedOpen: false });

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', true),
      );

      await waitFor(() => expect(result.current.hasDnsDrift).toBe(true));
    });

    it('uses hasProductDNSConflict when currentIps is undefined', async function undefinedIps() {
      mockResponse({ hasProductDNSConflict: true, failedOpen: false });

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', true),
      );

      await waitFor(() => expect(result.current.hasDnsDrift).toBe(true));
    });

    it('returns false via hasProductDNSConflict when no conflict', async function noConflictFallback() {
      mockResponse({ hasProductDNSConflict: false, currentIps: null, failedOpen: false });

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', undefined, true),
      );

      await waitFor(() => expect(appFetch).toHaveBeenCalled());
      expect(result.current.hasDnsDrift).toBe(false);
    });
  });

  describe('failedOpen — safe fallback', function failedOpenTests() {
    it('returns false when failedOpen is true', async function failedOpenFalse() {
      mockResponse({ hasProductDNSConflict: true, currentIps: null, failedOpen: true });

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', true),
      );

      await waitFor(() => expect(appFetch).toHaveBeenCalled());
      expect(result.current.hasDnsDrift).toBe(false);
    });
  });

  describe('HTTP errors', function httpErrorTests() {
    it('returns false on non-OK response', async function httpError() {
      mockResponse({}, false);

      const { result } = renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'example.com', '1.2.3.4', true),
      );

      await waitFor(() => expect(appFetch).toHaveBeenCalled());
      expect(result.current.hasDnsDrift).toBe(false);
    });
  });

  describe('request construction', function requestTests() {
    it('encodes fqdn in query string', async function encodedFqdn() {
      mockResponse({ hasProductDNSConflict: false, currentIps: ['1.2.3.4'], failedOpen: false });

      renderHookWithProviders(() =>
        useDomainConflictCheck('app-1', 'my domain.com', '1.2.3.4', true),
      );

      await waitFor(() => expect(appFetch).toHaveBeenCalled());
      expect(appFetch).toHaveBeenCalledWith(
        '/api/apps/app-1/dns-check-conflict?fqdn=my%20domain.com',
      );
    });
  });
});
