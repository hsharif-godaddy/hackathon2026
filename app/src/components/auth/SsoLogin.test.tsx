import '@testing-library/jest-dom';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import SsoLogin from './SsoLogin';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

const originalLocation = window.location;

let latestOnAuth: ((data?: unknown) => void) | null = null;
let latestPageToLoadParams: Record<string, unknown> | null = null;

function overrideWindowLocation(urlString: string) {
  const url = new URL(urlString);
  const mockLocation: Partial<Location> = {
    ancestorOrigins: originalLocation.ancestorOrigins,
    assign: vi.fn(),
    reload: vi.fn(),
    replace: vi.fn(),
    hash: url.hash,
    host: url.host,
    hostname: url.hostname,
    href: url.toString(),
    origin: url.origin,
    pathname: url.pathname,
    port: url.port,
    protocol: url.protocol,
    search: url.search,
  };

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: mockLocation as Location,
  });
}

vi.mock('next/dynamic', () => ({
  default: () => function MockSsoDeck(props: any) {
    latestOnAuth = props.onAuth;
    latestPageToLoadParams = props.pageToLoadParams;
    return <div data-testid="sso-deck" />;
  },
}));

vi.mock('@ux/modal', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="ux-modal">{children}</div>,
}));

vi.mock('@ux/alert', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="ux-alert">{children}</div>,
}));

vi.mock('@ux/spinner', () => ({
  __esModule: true,
  default: () => <div data-testid="ux-spinner" />,
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

// Mock store state that can be modified per test
const mockAuthUIState = {
  isSsoLoginOpen: true,
  isSsoLoading: false,
  closeSsoLogin: vi.fn(),
  setSsoLoaded: vi.fn(),
  redirectUrl: null as string | null,
  setRedirectUrl: vi.fn(),
};

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: (selector?: any) => (typeof selector === 'function' ? selector(mockAuthUIState) : mockAuthUIState),
}));

vi.mock('@/stores/useSitesStore', () => {
  const state = {
    clearRequiresAuth: vi.fn(),
    fetchSite: vi.fn(),
  };
  return {
    useSitesStore: (selector?: any) => (typeof selector === 'function' ? selector(state) : state),
  };
});

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

function setRedirectParam(value: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete('redirect');
  if (value) {
    url.searchParams.set('redirect', value);
  }
  overrideWindowLocation(url.toString());
}

async function triggerAuth() {
  await waitFor(function waitForDeck() {
    expect(latestOnAuth).toBeInstanceOf(Function);
  });
  latestOnAuth?.();
}

describe('SsoLogin redirect handling', function ssoLoginRedirectTests() {
  beforeAll(function stubLocation() {
    overrideWindowLocation('https://airo-builder.test/');
  });

  afterAll(function restoreLocation() {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    latestOnAuth = null;
    latestPageToLoadParams = null;
    mockAuthUIState.redirectUrl = null;
  });

  it('navigates to same-origin redirect path', async function redirectsToSameOrigin() {
    setRedirectParam('/develop/ghe4xo1sbb?siteId=ghe4xo1sbb');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(assignSpy).toHaveBeenCalledWith('https://airo-builder.test/develop/ghe4xo1sbb?siteId=ghe4xo1sbb');
    assignSpy.mockRestore();
  });

  it('blocks absolute cross-origin redirects', async function blocksCrossOrigin() {
    setRedirectParam('https://evil.com/phish');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(assignSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.auth.redirect.rejected', expect.any(Object));
    assignSpy.mockRestore();
  });

  it('blocks protocol-relative redirects', async function blocksProtocolRelative() {
    setRedirectParam('//evil.com/phish');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(assignSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.auth.redirect.rejected', expect.any(Object));
    assignSpy.mockRestore();
  });

  it('passes full URL with path to SsoDeck when redirectUrl is set', async function passesFullUrl() {
    mockAuthUIState.redirectUrl = '/develop/abc123?foo=bar';

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/develop/abc123?foo=bar'
    });
  });

  it('falls back to currentOrigin when redirectUrl validation fails', async function fallsBackOnValidationFailure() {
    mockAuthUIState.redirectUrl = '/login';  // Auth path - should be rejected

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test'
    });
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.pageToLoadParams.invalid-redirect', expect.any(Object));
  });

  it('handles malformed redirectUrl gracefully', async function handlesMalformedUrl() {
    // Use a protocol-relative URL that will fail origin check
    mockAuthUIState.redirectUrl = '//evil.com/phish';

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test'
    });
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.pageToLoadParams.invalid-redirect', expect.any(Object));
  });

  it('passes only currentOrigin when redirectUrl is null', async function passesOriginOnly() {
    mockAuthUIState.redirectUrl = null;

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test'
    });
  });
});
