/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const {
  mockSetDomainConnectCallbackResult,
  mockSetDomainConnectSucceeded,
  mockLogImpressionEvent,
} = vi.hoisted(function hoisted() {
  return {
    mockSetDomainConnectCallbackResult: vi.fn(),
    mockSetDomainConnectSucceeded: vi.fn(),
    mockLogImpressionEvent: vi.fn(function () { return vi.fn(); }),
  };
});

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: mockLogImpressionEvent,
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(vi.fn(), {
    getState: () => ({
      setDomainConnectCallbackResult: mockSetDomainConnectCallbackResult,
      setDomainConnectSucceeded: mockSetDomainConnectSucceeded,
    }),
  }),
}));

import { useDomainConnectCallbackConsumer } from '../useDomainConnectCallbackConsumer';

function makeSearchParams(params: Record<string, string | null>) {
  return { get: (key: string) => params[key] ?? null };
}

describe('useDomainConnectCallbackConsumer', function tests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/app/123?domainConnect=success&domain=test.com&other=1' },
      writable: true,
      configurable: true,
    });
  });

  it('maps success status to success result and sets succeeded flag', function successPath() {
    const searchParams = makeSearchParams({ domainConnect: 'success', domain: 'test.com' });
    renderHook(() => useDomainConnectCallbackConsumer(searchParams, 'app-123'));

    expect(mockSetDomainConnectCallbackResult).toHaveBeenCalledWith('success');
    expect(mockSetDomainConnectSucceeded).toHaveBeenCalledWith('app-123', true);
  });

  it('scrubs domainConnect and domain query params from the URL on success', function scrubOnSuccess() {
    const searchParams = makeSearchParams({ domainConnect: 'success', domain: 'test.com' });
    renderHook(() => useDomainConnectCallbackConsumer(searchParams, 'app-123'));

    expect(window.history.replaceState).toHaveBeenCalledOnce();
    const replacedUrl = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls[0][2] as URL;
    expect(replacedUrl.searchParams.has('domainConnect')).toBe(false);
    expect(replacedUrl.searchParams.has('domain')).toBe(false);
    expect(replacedUrl.searchParams.has('other')).toBe(true);
  });

  it('maps non-success status to error result and does not set succeeded flag', function errorPath() {
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/app/123?domainConnect=error&domain=test.com' },
      writable: true,
      configurable: true,
    });
    const searchParams = makeSearchParams({ domainConnect: 'error', domain: 'test.com' });
    renderHook(() => useDomainConnectCallbackConsumer(searchParams, 'app-123'));

    expect(mockSetDomainConnectCallbackResult).toHaveBeenCalledWith('error');
    expect(mockSetDomainConnectSucceeded).not.toHaveBeenCalled();
    expect(window.history.replaceState).toHaveBeenCalledOnce();
  });

  it('does nothing when domainConnect param is absent', function noParamNoOp() {
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/app/123' },
      writable: true,
      configurable: true,
    });
    const searchParams = makeSearchParams({});
    renderHook(() => useDomainConnectCallbackConsumer(searchParams, 'app-123'));

    expect(mockSetDomainConnectCallbackResult).not.toHaveBeenCalled();
    expect(mockSetDomainConnectSucceeded).not.toHaveBeenCalled();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it('does nothing when appId is null', function nullAppIdNoOp() {
    const searchParams = makeSearchParams({ domainConnect: 'success', domain: 'test.com' });
    renderHook(() => useDomainConnectCallbackConsumer(searchParams, null));

    expect(mockSetDomainConnectCallbackResult).not.toHaveBeenCalled();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });
});
