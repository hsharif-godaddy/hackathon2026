/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';

// Numeric literals — avoids pulling in @airo/shared/auth via features.ts
const AUTH_CODE = { LOGIN: 1, HBI: 2, VAT: 3 } as const;
const RETURNING_USER_COOKIE = 'airo_returning_user';
import SsoLogin from './SsoLogin';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

const originalLocation = window.location;

let latestOnAuth: ((data?: unknown) => void) | null = null;
let latestPageToLoadParams: Record<string, unknown> | null = null;
let latestPageToLoad: string | null = null;
let latestConsumingPath: string | null = null;

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
    latestPageToLoad = props.pageToLoad;
    latestConsumingPath = props.consumingPath;
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

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: true,
    isLoading: false,
    authState: null,
    isMockAuth: false,
    authType: 'jwt',
    mockAuth: null,
    config: null,
    gasketConfig: null,
    configLoading: false,
    configError: null,
    getUserEmail: vi.fn(),
    getUserInfo: vi.fn(),
    handleSignOut: vi.fn(),
  }),
}));

// Mock store state that can be modified per test
const mockAuthUIState = {
  isSsoLoginOpen: true,
  isSsoLoading: false,
  closeSsoLogin: vi.fn(),
  setSsoLoaded: vi.fn(),
  redirectUrl: null as string | null,
  setRedirectUrl: vi.fn(),
  ssoAuthReason: null as number | null,
  inFlightReauth: false,
  setInFlightReauth: vi.fn(),
};

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: (selector?: any) => (typeof selector === 'function' ? selector(mockAuthUIState) : mockAuthUIState),
}));

const mockSitesStoreState = vi.hoisted(() => ({
  clearRequiresAuth: vi.fn(),
  fetchSite: vi.fn(),
}));

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: (selector?: any) =>
    typeof selector === 'function' ? selector(mockSitesStoreState) : mockSitesStoreState,
}));

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

async function triggerAuth(data?: unknown) {
  await waitFor(function waitForDeck() {
    expect(latestOnAuth).toBeInstanceOf(Function);
  });
  latestOnAuth?.(data);
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
    overrideWindowLocation('https://airo-builder.test/');
    latestOnAuth = null;
    latestPageToLoadParams = null;
    latestPageToLoad = null;
    latestConsumingPath = null;
    mockAuthUIState.redirectUrl = null;
    mockAuthUIState.ssoAuthReason = null;
    mockAuthUIState.inFlightReauth = false;
  });

  it('navigates to same-origin redirect path', async function redirectsToSameOrigin() {
    setRedirectParam('/develop/ghe4xo1sbb?siteId=ghe4xo1sbb');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(assignSpy).toHaveBeenCalledWith('https://airo-builder.test/develop/ghe4xo1sbb?siteId=ghe4xo1sbb');
    expect(mockAuthUIState.closeSsoLogin).not.toHaveBeenCalled();
    assignSpy.mockRestore();
  });

  it('blocks absolute cross-origin redirects', async function blocksCrossOrigin() {
    setRedirectParam('https://evil.com/phish');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(assignSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.auth.redirect.rejected', expect.any(Object));
    assignSpy.mockRestore();
  });

  it('blocks protocol-relative redirects', async function blocksProtocolRelative() {
    setRedirectParam('//evil.com/phish');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});

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
    expect(latestConsumingPath).toBe('/develop/abc123?foo=bar');
  });

  it('passes relative consumingPath when redirectUrl is an absolute same-origin URL', async function passesRelativePathForAbsoluteUrl() {
    mockAuthUIState.redirectUrl = 'https://airo-builder.test/develop/abc123?foo=bar#preview';

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/develop/abc123?foo=bar#preview'
    });
    expect(latestConsumingPath).toBe('/develop/abc123?foo=bar#preview');
  });

  it('falls back to current page when redirectUrl validation fails', async function fallsBackOnValidationFailure() {
    mockAuthUIState.redirectUrl = '/login';  // Auth path - should be rejected
    overrideWindowLocation('https://airo-builder.test/develop/current?tab=settings');

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/develop/current?tab=settings'
    });
    expect(latestConsumingPath).toBe('/develop/current?tab=settings');
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.return-target.invalid-redirect', expect.any(Object));
  });

  it('handles malformed redirectUrl gracefully', async function handlesMalformedUrl() {
    // Use a protocol-relative URL that will fail origin check
    mockAuthUIState.redirectUrl = '//evil.com/phish';
    overrideWindowLocation('https://airo-builder.test/develop/current');

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/develop/current'
    });
    expect(latestConsumingPath).toBe('/develop/current');
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.return-target.invalid-redirect', expect.any(Object));
  });

  it('falls back to current page when store redirectUrl is absolute cross-origin', async function fallsBackForAbsoluteCrossOriginStoreRedirect() {
    mockAuthUIState.redirectUrl = 'https://evil.com/phish';
    overrideWindowLocation('https://airo-builder.test/develop/current?tab=settings');

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/develop/current?tab=settings'
    });
    expect(latestConsumingPath).toBe('/develop/current?tab=settings');
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.return-target.invalid-redirect', expect.any(Object));
  });

  it('prefers store redirectUrl over SSO redirect_url pointing to root', async function storeOverSso() {
    mockAuthUIState.redirectUrl = '/develop/abc123';
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth({ data: { redirect_url: 'https://airo-builder.test/' } });

    expect(assignSpy).toHaveBeenCalledWith('/develop/abc123');
    expect(mockAuthUIState.closeSsoLogin).not.toHaveBeenCalled();
    expect(mockAuthUIState.setRedirectUrl).toHaveBeenCalledWith(null);
    assignSpy.mockRestore();
  });

  it('redirects to absolute same-origin store redirectUrl after auth', async function redirectsToAbsoluteSameOriginStoreRedirect() {
    mockAuthUIState.redirectUrl = 'https://airo-builder.test/develop/abc123';
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth({ data: { redirect_url: 'https://airo-builder.test/' } });

    expect(assignSpy).toHaveBeenCalledWith('https://airo-builder.test/develop/abc123');
    expect(mockAuthUIState.closeSsoLogin).not.toHaveBeenCalled();
    expect(mockAuthUIState.setRedirectUrl).toHaveBeenCalledWith(null);
    assignSpy.mockRestore();
  });

  it('uses SSO redirect_url when no store redirectUrl is set', async function ssoFallback() {
    mockAuthUIState.redirectUrl = null;
    overrideWindowLocation('https://airo-builder.test/');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth({ data: { redirect_url: 'https://airo-builder.test/some-page' } });

    expect(assignSpy).toHaveBeenCalledWith('https://airo-builder.test/some-page');
    expect(mockAuthUIState.closeSsoLogin).toHaveBeenCalledWith('success');
    assignSpy.mockRestore();
  });

  it('reloads current page when no redirect is available', async function reloadFallback() {
    mockAuthUIState.redirectUrl = null;
    overrideWindowLocation('https://airo-builder.test/develop/abc123');
    const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(reloadSpy).toHaveBeenCalled();
    expect(mockAuthUIState.closeSsoLogin).toHaveBeenCalledWith('success');
    reloadSpy.mockRestore();
  });

  it('passes current page when redirectUrl is null', async function passesCurrentPageWhenNoRedirectUrl() {
    mockAuthUIState.redirectUrl = null;
    overrideWindowLocation('https://airo-builder.test/develop/current?tab=settings#preview');

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoadParams).toBeTruthy();
    });

    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/develop/current?tab=settings#preview'
    });
    expect(latestConsumingPath).toBe('/develop/current?tab=settings#preview');
  });
});

describe('SsoLogin authReason routing', function ssoLoginAuthReasonTests() {
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
    overrideWindowLocation('https://airo-builder.test/');
    latestOnAuth = null;
    latestPageToLoadParams = null;
    latestPageToLoad = null;
    latestConsumingPath = null;
    mockAuthUIState.redirectUrl = null;
    mockAuthUIState.ssoAuthReason = null;
    mockAuthUIState.inFlightReauth = false;
    // Clear returning-user cookie before each test
    document.cookie = `${RETURNING_USER_COOKIE}=; Max-Age=0; Path=/`;
  });

  afterEach(function clearCookie() {
    document.cookie = `${RETURNING_USER_COOKIE}=; Max-Age=0; Path=/`;
  });

  it('routes to /account/create when authReason is null and no returning-user cookie', async function newUserRoutesToCreateAccount() {
    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/account/create');
    expect(latestConsumingPath).toBe('/');
  });

  it('routes to /login when authReason is null and returning-user cookie is set', async function returningUserRoutesToLogin() {
    document.cookie = `${RETURNING_USER_COOKIE}=1; Path=/`;

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/login');
    expect(latestConsumingPath).toBe('/');
  });

  it('routes to /hbi when authReason is HBI regardless of cookie', async function routesToHbi() {
    mockAuthUIState.ssoAuthReason = AUTH_CODE.HBI;

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/hbi');
    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/',
      auth_reason: '2'
    });
    expect(latestConsumingPath).toBe('/');
  });

  it('routes to /login when authReason is LOGIN (session expiry, ignores cookie)', async function routesToLoginForCode1() {
    mockAuthUIState.ssoAuthReason = AUTH_CODE.LOGIN;

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/login');
    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/',
      auth_reason: '1'
    });
    expect(latestConsumingPath).toBe('/');
  });

  it('routes to /login when authReason is VAT (session expiry, ignores cookie)', async function routesToLoginForCode3() {
    mockAuthUIState.ssoAuthReason = AUTH_CODE.VAT;

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/login');
    expect(latestPageToLoadParams).toEqual({
      redirect_url: 'https://airo-builder.test/',
      auth_reason: '3'
    });
    expect(latestConsumingPath).toBe('/');
  });
});

describe('SsoLogin in-flight reauth', function inFlightReauthTests() {
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
    overrideWindowLocation('https://airo-builder.test/develop/abc123');
    latestOnAuth = null;
    latestPageToLoadParams = null;
    latestPageToLoad = null;
    latestConsumingPath = null;
    mockAuthUIState.redirectUrl = null;
    mockAuthUIState.ssoAuthReason = null;
    mockAuthUIState.inFlightReauth = false;
  });

  it('closes with success and does not navigate when inFlightReauth is true', async function inFlightSkipsNav() {
    // openModalAndVerify sets both: redirectUrl is used by SsoDeck for the
    // iframe consumingPath, but the post-auth navigation must be skipped.
    mockAuthUIState.inFlightReauth = true;
    mockAuthUIState.redirectUrl = 'https://airo-builder.test/develop/abc123';
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});
    const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth({ data: { redirect_url: 'https://airo-builder.test/' } });

    expect(assignSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(mockAuthUIState.closeSsoLogin).toHaveBeenCalledWith('success');
    expect(mockSitesStoreState.clearRequiresAuth).toHaveBeenCalled();
    expect(mockAuthUIState.setRedirectUrl).not.toHaveBeenCalled();
    assignSpy.mockRestore();
    reloadSpy.mockRestore();
  });

  it('takes the navigation path when inFlightReauth is false (existing behavior)', async function nonInFlightStillNavigates() {
    mockAuthUIState.inFlightReauth = false;
    mockAuthUIState.redirectUrl = 'https://airo-builder.test/develop/abc123';
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(assignSpy).toHaveBeenCalledWith('https://airo-builder.test/develop/abc123');
    expect(mockAuthUIState.closeSsoLogin).not.toHaveBeenCalled();
    assignSpy.mockRestore();
  });
});
