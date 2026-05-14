/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useIscResolver } from './useIscResolver';

function clearIscCookie() {
  document.cookie = 'isc=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
}

function setIscCookie(value: string) {
  document.cookie = `isc=${value};path=/`;
}

function setSearch(search: string) {
  window.history.replaceState({}, '', `/${search}`);
}

describe('useIscResolver', () => {
  afterEach(() => {
    clearIscCookie();
    setSearch('');
  });

  it('returns the URL-param ISC when it is a known code', () => {
    setSearch('?isc=GDWELCOME');
    const { result } = renderHook(() => useIscResolver());
    expect(result.current).toEqual({ isc: 'GDWELCOME', source: 'url' });
  });

  it('falls back to the cookie when no URL param is present', () => {
    setIscCookie('GOTIME');
    const { result } = renderHook(() => useIscResolver());
    expect(result.current).toEqual({ isc: 'GOTIME', source: 'cookie' });
  });

  it('prefers the URL param over the cookie (always-overwrite policy)', () => {
    setSearch('?isc=GDWELCOME');
    setIscCookie('GOTIME');
    const { result } = renderHook(() => useIscResolver());
    expect(result.current).toEqual({ isc: 'GDWELCOME', source: 'url' });
  });

  it('falls through to the cookie when the URL param is not allowlisted', () => {
    setSearch('?isc=FAKECODE');
    setIscCookie('GOGERMANY');
    const { result } = renderHook(() => useIscResolver());
    expect(result.current).toEqual({ isc: 'GOGERMANY', source: 'cookie' });
  });

  it('returns null when neither URL nor cookie has a valid ISC', () => {
    const { result } = renderHook(() => useIscResolver());
    expect(result.current).toEqual({ isc: null, source: null });
  });

  it('normalizes a lowercase URL param to the canonical uppercase form', () => {
    setSearch('?isc=gdwelcome');
    const { result } = renderHook(() => useIscResolver());
    expect(result.current).toEqual({ isc: 'GDWELCOME', source: 'url' });
  });

  it('normalizes a lowercase cookie value to the canonical uppercase form', () => {
    setIscCookie('goindia');
    const { result } = renderHook(() => useIscResolver());
    expect(result.current).toEqual({ isc: 'GOINDIA', source: 'cookie' });
  });

  it('ignores an unrelated cookie when no isc cookie is set', () => {
    document.cookie = 'other=value;path=/';
    const { result } = renderHook(() => useIscResolver());
    expect(result.current).toEqual({ isc: null, source: null });
    document.cookie = 'other=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  });

  it('does not throw on a malformed (bad percent-encoding) cookie value', () => {
    // %E0%A4%A is a truncated UTF-8 sequence that makes decodeURIComponent
    // throw URIError. The hook must degrade to null, never crash the widget.
    document.cookie = 'isc=%E0%A4%A;path=/';
    const { result } = renderHook(() => useIscResolver());
    expect(result.current.isc).toBeNull();
  });
});
