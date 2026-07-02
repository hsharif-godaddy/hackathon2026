/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';

// Numeric literals — avoids pulling in @airo/shared/auth via features.ts
const AUTH_CODE = { LOGIN: 1, HBI: 2, VAT: 3 } as const;
const RETURNING_USER_COOKIE = 'airo_returning_user';
import SsoLogin from './SsoLogin';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

const mockHandleSignIn = vi.hoisted(() => vi.fn());

const originalLocation = window.location;

let latestOnAuth: ((data?: unknown) => void) | null = null;
let latestOnError: ((err?: unknown) => void) | null = null;
let latestPageToLoadParams: Record<string, unknown> | null = null;
let latestPageToLoad: string | null = null;
let latestConsumingPath: string | null = null;
let latestEnableCheckoutLite: boolean | undefined = undefined;

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
    latestOnError = props.onError;
    latestPageToLoadParams = props.pageToLoadParams;
    latestPageToLoad = props.pageToLoad;
    latestConsumingPath = props.consumingPath;
    latestEnableCheckoutLite = props.enableCheckoutLite;
    return <div data-testid="sso-deck" />;
  },
}));

const mockSwitchboardFlags: Record<string, boolean> = {};
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockSwitchboardFlags[flag],
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

vi.mock('@ux/button', () => ({
  __esModule: true,
  default: ({ text, onClick }: any) => <button onClick={onClick}>{text}</button>,
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
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
    handleSignIn: mockHandleSignIn,
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
  isSessionReauth: false,
  setInFlightReauth: vi.fn(),
};

vi.mock('@/stores/useAuthUIStore', () => {
  const store = Object.assign(
    (selector?: any) => (typeof selector === 'function' ? selector(mockAuthUIState) : mockAuthUIState),
    {
      getState: () => mockAuthUIState,
      setState: (partial: Record<string, unknown>) => Object.assign(mockAuthUIState, partial),
    },
  );
  return { useAuthUIStore: store };
});

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
    latestEnableCheckoutLite = undefined;
    mockAuthUIState.redirectUrl = null;
    mockAuthUIState.ssoAuthReason = null;
    mockAuthUIState.inFlightReauth = false;
    mockAuthUIState.isSessionReauth = false;
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
    latestEnableCheckoutLite = undefined;
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
    latestEnableCheckoutLite = undefined;
    mockAuthUIState.redirectUrl = null;
    mockAuthUIState.ssoAuthReason = null;
    mockAuthUIState.inFlightReauth = false;
    mockAuthUIState.isSessionReauth = false;
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

  it('takes the navigation path when neither inFlightReauth nor isSessionReauth', async function explicitRedirectNavigates() {
    mockAuthUIState.inFlightReauth = false;
    mockAuthUIState.isSessionReauth = false;
    mockAuthUIState.redirectUrl = 'https://airo-builder.test/develop/abc123';
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(assignSpy).toHaveBeenCalledWith('https://airo-builder.test/develop/abc123');
    expect(mockAuthUIState.closeSsoLogin).not.toHaveBeenCalled();
    assignSpy.mockRestore();
  });

  it('closes without navigation when isSessionReauth is true (passive re-auth)', async function sessionReauthSkipsNav() {
    mockAuthUIState.inFlightReauth = false;
    mockAuthUIState.isSessionReauth = true;
    mockAuthUIState.redirectUrl = '/develop/abc123';
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(function () {});
    const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(function () {});

    renderWithProviders(<SsoLogin />);
    await triggerAuth();

    expect(assignSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(mockAuthUIState.closeSsoLogin).toHaveBeenCalledWith('success');
    assignSpy.mockRestore();
    reloadSpy.mockRestore();
  });
});

describe('SsoLogin SSO Lite flag wiring', function ssoLiteFlagTests() {
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
    latestEnableCheckoutLite = undefined;
    mockAuthUIState.redirectUrl = null;
    mockAuthUIState.ssoAuthReason = null;
    mockAuthUIState.inFlightReauth = false;
    delete mockSwitchboardFlags['appbuilder-sso-lite'];
  });

  it('passes enableCheckoutLite and routes to /login/progressive when flag is on', async function flagOnPassesProps() {
    mockSwitchboardFlags['appbuilder-sso-lite'] = true;

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/login/progressive');
    expect(latestEnableCheckoutLite).toBe(true);
  });

  it('does not pass enableCheckoutLite when flag is off', async function flagOffNoProps() {
    mockSwitchboardFlags['appbuilder-sso-lite'] = false;

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/account/create');
    expect(latestEnableCheckoutLite).toBeUndefined();
  });

  it('does not pass enableCheckoutLite when flag is undefined (Switchboard unavailable)', async function flagUndefinedNoProps() {
    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/account/create');
    expect(latestEnableCheckoutLite).toBeUndefined();
  });

  it('still routes to /hbi for HBI even when flag is on', async function hbiUnaffectedByFlag() {
    mockSwitchboardFlags['appbuilder-sso-lite'] = true;
    mockAuthUIState.ssoAuthReason = AUTH_CODE.HBI;

    renderWithProviders(<SsoLogin />);

    await waitFor(() => {
      expect(latestPageToLoad).toBeTruthy();
    });

    expect(latestPageToLoad).toBe('/hbi');
  });
});

describe('SsoLogin iframe load failure fallback', function ssoLoadFailureTests() {
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
    latestOnError = null;
    mockAuthUIState.redirectUrl = null;
    mockAuthUIState.ssoAuthReason = null;
    mockAuthUIState.inFlightReauth = false;
    mockAuthUIState.isSsoLoading = true;
    delete mockSwitchboardFlags['appbuilder-sso-lite'];
    mockSwitchboardFlags['appbuilder-sso-modal-fallback'] = true;
  });

  afterEach(function cleanupFlags() {
    delete mockSwitchboardFlags['appbuilder-sso-modal-fallback'];
    vi.useRealTimers();
  });

  async function renderAndFailIframe() {
    renderWithProviders(<SsoLogin />);
    await waitFor(function waitForDeck() {
      expect(latestOnError).toBeInstanceOf(Function);
    });
    await act(async function fireError() {
      latestOnError?.(new Error('blocked'));
    });
  }

  it('shows retry + sign-in fallback (and hides the deck) when the iframe errors', async function showsFallbackOnError() {
    await renderAndFailIframe();

    expect(screen.getByText('builder_common_try_again')).toBeInTheDocument();
    expect(screen.getByText('builder_common_signin')).toBeInTheDocument();
    expect(screen.queryByTestId('sso-deck')).not.toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith('sso-login.iframe.error', expect.any(Object));
  });

  it('remounts the SSO deck when the user clicks try again', async function retryRemountsDeck() {
    await renderAndFailIframe();
    expect(screen.queryByTestId('sso-deck')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('builder_common_try_again'));

    await waitFor(function deckBack() {
      expect(screen.getByTestId('sso-deck')).toBeInTheDocument();
    });
  });

  it('does a full-page SSO redirect carrying authReason when the user clicks sign in', async function fallbackRedirect() {
    mockAuthUIState.ssoAuthReason = AUTH_CODE.HBI;
    await renderAndFailIframe();

    fireEvent.click(screen.getByText('builder_common_signin'));

    expect(mockHandleSignIn).toHaveBeenCalledWith('https://airo-builder.test/', AUTH_CODE.HBI);
  });

  it('does not wire onError or show the fallback when the flag is off', async function flagOffNoFallback() {
    mockSwitchboardFlags['appbuilder-sso-modal-fallback'] = false;

    renderWithProviders(<SsoLogin />);

    await waitFor(function waitForDeck() {
      expect(screen.getByTestId('sso-deck')).toBeInTheDocument();
    });

    // onError is not passed to the deck, so a blocked iframe can't flip to the
    // fallback — prior behavior preserved when the flag is off.
    expect(latestOnError).toBeUndefined();
    expect(screen.queryByText('builder_common_try_again')).not.toBeInTheDocument();
    expect(screen.queryByText('builder_common_signin')).not.toBeInTheDocument();
  });

  it('shows fallback after SSO_LOAD_TIMEOUT_MS when iframe never loads', async function timeoutShowsFallback() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockAuthUIState.isSsoLoading = true;

    renderWithProviders(<SsoLogin />);

    await waitFor(function waitForDeck() {
      expect(screen.getByTestId('sso-deck')).toBeInTheDocument();
    });

    // No onLoad or onError — the timer is the only path to fallback.
    expect(screen.queryByText('builder_common_try_again')).not.toBeInTheDocument();

    act(function advanceTimer() {
      vi.advanceTimersByTime(15_000);
    });

    await waitFor(function waitForFallback() {
      expect(screen.getByText('builder_common_try_again')).toBeInTheDocument();
    });

    expect(screen.getByText('builder_common_signin')).toBeInTheDocument();
    expect(screen.queryByTestId('sso-deck')).not.toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'sso-login.iframe.load-timeout',
      expect.objectContaining({ timeoutMs: 15_000 }),
    );
  });

  it('does not fire timeout when isSsoLoading is false (iframe already loaded)', async function noTimeoutWhenLoaded() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockAuthUIState.isSsoLoading = false;

    renderWithProviders(<SsoLogin />);

    await waitFor(function waitForDeck() {
      expect(screen.getByTestId('sso-deck')).toBeInTheDocument();
    });

    act(function advanceTimer() {
      vi.advanceTimersByTime(15_000);
    });

    // Timer didn't fire — fallback never renders
    expect(screen.queryByText('builder_common_try_again')).not.toBeInTheDocument();
    expect(screen.getByTestId('sso-deck')).toBeInTheDocument();
  });
});
