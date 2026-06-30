import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';

const mockGetEmailFromDocumentInfoIdpCookies = vi.fn();

vi.mock('@/lib/auth/info-idp-cookie', () => ({
  getEmailFromDocumentInfoIdpCookies: () => mockGetEmailFromDocumentInfoIdpCookies(),
}));

import { useAuth } from './useAuth';

// Mock dependencies
vi.mock('@godaddy/gasket-auth', () => ({
  useAuthState: vi.fn(function () { return {
    status: 'authenticated',
    valid: true,
    details: { email: 'test@example.com', cid: 'customer-123' },
  }; }),
  AuthRealmType: {},
  AuthRiskType: {},
  AuthIdpType: {},
}));

vi.mock('@/hooks/useMockAuth', () => ({
  useMockAuth: vi.fn(function () { return {
    isAuthenticated: false,
    isLoading: false,
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
  }; }),
}));

vi.mock('@/lib/features', () => ({
  auth: {
    getType: vi.fn(function () { return 'MOCK'; }),
    isMock: vi.fn(function () { return true; }),
    isJWT: vi.fn(function () { return false; }),
  },
  authUtils: {
    getSupportedAuthTypes: vi.fn(function () { return ['sso']; }),
  },
}));

// Default test config returned by getGasketConfig
const defaultTestConfig = {
  auth: {
    realm: 'idp',
    risk: 'low',
    type: ['sso'],
    authType: 'MOCK',
    isMock: true,
    isJWT: false,
  },
  sso: {
    loginUrl: 'https://sso.example.com/login',
    logoutUrl: 'https://sso.example.com/logout',
  },
  redirects: {
    loginRedirectUrl: 'https://app.example.com',
    logoutRedirectUrl: 'https://app.example.com/logout',
  },
};

// Mutable reference so tests can swap the config
let mockGasketConfig = { ...defaultTestConfig };

vi.mock('@/lib/gasket-config', () => ({
  getGasketConfig: vi.fn(function () { return Promise.resolve(mockGasketConfig); }),
  getLoginUrl: vi.fn(function (returnUrl?: string) { return Promise.resolve(`${mockGasketConfig.sso.loginUrl}?app=airo-builder${returnUrl ? `&path=${encodeURIComponent(returnUrl)}` : ''}`); }
  ),
  getLogoutUrl: vi.fn(function () {
    return Promise.resolve(`${mockGasketConfig.sso.logoutUrl}?app=airo-builder&redirect=${encodeURIComponent(mockGasketConfig.redirects.logoutRedirectUrl)}`);
  }),
  authConfigs: {
    user: {
      realm: 'idp',
      risk: 'low',
      type: ['sso'],
      allowHeartbeat: true,
      use12HourExpiration: true,
    },
  },
  isAuthMockSync: vi.fn(function () { return true; }),
  isAuthJWTSync: vi.fn(function () { return false; }),
  getAuthTypeSync: vi.fn(function () { return 'MOCK'; }),
  GasketConfig: {},
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const { mockUseAuthUIStore } = vi.hoisted(() => {
  const store = {};
  const useAuthUIStore: any = vi.fn(function (selector?: (state: typeof store) => any) {
    return selector ? selector(store) : store;
  });
  useAuthUIStore.getState = () => store;
  return { mockUseAuthUIStore: useAuthUIStore };
});

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: mockUseAuthUIStore,
}));

describe('useAuth', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset gasket config mock to default
    mockGasketConfig = { ...defaultTestConfig };

    // Reset getGasketConfig mock implementation
    const gasketConfigModule = await import('@/lib/gasket-config');
    vi.mocked(gasketConfigModule.getGasketConfig).mockImplementation(function () { return Promise.resolve(mockGasketConfig); });
    vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(true);
    vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(false);
    vi.mocked(gasketConfigModule.getAuthTypeSync).mockReturnValue('MOCK');
  });

  it('should load configuration on mount', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.config).not.toBeNull();
    });

    expect(result.current.config?.auth.authType).toBe('MOCK');
  });

  it('should return authentication state', () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current).toHaveProperty('isAuthenticated');
    expect(result.current).toHaveProperty('isLoading');
  });

  it('should provide getUserEmail function', () => {
    const { result } = renderHook(() => useAuth());

    expect(typeof result.current.getUserEmail).toBe('function');
  });

  it('should provide getUserInfo function', () => {
    const { result } = renderHook(() => useAuth());

    expect(typeof result.current.getUserInfo).toBe('function');
    const userInfo = result.current.getUserInfo();
    expect(userInfo).toHaveProperty('customerId');
    expect(userInfo).toHaveProperty('email');
  });

  it('should provide handleSignIn function', () => {
    const { result } = renderHook(() => useAuth());

    expect(typeof result.current.handleSignIn).toBe('function');
  });

  it('should provide handleSignOut function', () => {
    const { result } = renderHook(() => useAuth());

    expect(typeof result.current.handleSignOut).toBe('function');
  });

  it('should handle config load error', async () => {
    const gasketConfigModule = await import('@/lib/gasket-config');
    vi.mocked(gasketConfigModule.getGasketConfig).mockRejectedValue(new Error('Config API error: 500'));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.configError).toBeTruthy();
    });
  });

  it('should return authType', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.authType).toBeDefined();
    });
  });

  it('should return isMockAuth flag', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(typeof result.current.isMockAuth).toBe('boolean');
    });
  });

  describe('tokenAuthType', () => {
    it('should return tokenAuthType from authState when JWT mode is enabled', async () => {
      // Configure JWT mode
      mockGasketConfig = {
        ...defaultTestConfig,
        auth: {
          ...defaultTestConfig.auth,
          isJWT: true,
          isMock: false,
        },
      };

      const gasketConfigModule = await import('@/lib/gasket-config');
      vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(true);
      vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(false);

      // Mock authState with e2s auth type (employee impersonation)
      const gasketAuth = await import('@godaddy/gasket-auth');
      vi.mocked(gasketAuth.useAuthState).mockReturnValue({
        status: 'loaded',
        valid: true,
        details: { email: 'employee@godaddy.com', cid: 'customer-456' },
        authType: 'e2s',
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.tokenAuthType).toBe('e2s');
      });
    });

    it('should return undefined tokenAuthType when mock auth mode is enabled', async () => {
      // Configure mock mode (default)
      mockGasketConfig = {
        ...defaultTestConfig,
        auth: {
          ...defaultTestConfig.auth,
          isJWT: false,
          isMock: true,
        },
      };

      const gasketConfigModule = await import('@/lib/gasket-config');
      vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(false);
      vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(true);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.tokenAuthType).toBeUndefined();
      });
    });

    it('should return undefined tokenAuthType when authState has no authType property', async () => {
      // Configure JWT mode
      mockGasketConfig = {
        ...defaultTestConfig,
        auth: {
          ...defaultTestConfig.auth,
          isJWT: true,
          isMock: false,
        },
      };

      const gasketConfigModule = await import('@/lib/gasket-config');
      vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(true);
      vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(false);

      // Mock authState without authType (simulates upstream change)
      const gasketAuth = await import('@godaddy/gasket-auth');
      vi.mocked(gasketAuth.useAuthState).mockReturnValue({
        status: 'loaded',
        valid: true,
        details: { email: 'user@example.com', cid: 'customer-789' },
        // No authType property
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.tokenAuthType).toBeUndefined();
      });
    });

    it('should read shopperId from auth validate payload when details is absent', async () => {
      mockGetEmailFromDocumentInfoIdpCookies.mockReturnValue(undefined);
      mockGasketConfig = {
        ...defaultTestConfig,
        auth: {
          ...defaultTestConfig.auth,
          isJWT: true,
          isMock: false,
        },
      };

      const gasketConfigModule = await import('@/lib/gasket-config');
      vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(true);
      vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(false);

      const gasketAuth = await import('@godaddy/gasket-auth');
      vi.mocked(gasketAuth.useAuthState).mockReturnValue({
        status: 'loaded',
        valid: true,
        payload: { shopperId: 'payload-shopper', cid: 'payload-customer' },
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.getUserInfo()).toEqual({
          customerId: 'payload-customer',
          shopperId: 'payload-shopper',
          accountName: undefined,
          email: undefined,
        });
      });
    });

    it('should not use cid as email when validate details omit email', async () => {
      mockGetEmailFromDocumentInfoIdpCookies.mockReturnValue(undefined);

      mockGasketConfig = {
        ...defaultTestConfig,
        auth: {
          ...defaultTestConfig.auth,
          isJWT: true,
          isMock: false,
        },
      };

      const gasketConfigModule = await import('@/lib/gasket-config');
      vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(true);
      vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(false);

      const gasketAuth = await import('@godaddy/gasket-auth');
      vi.mocked(gasketAuth.useAuthState).mockReturnValue({
        status: 'loaded',
        valid: true,
        details: { shopperId: 'shopper-1', cid: 'customer-uuid-not-email' },
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.getUserEmail()).toBeUndefined();
        expect(result.current.getUserInfo().email).toBeUndefined();
      });
      expect(mockGetEmailFromDocumentInfoIdpCookies).toHaveBeenCalled();
    });

    it('should fall back to info_idp cookie email when validate details omit email', async () => {
      mockGetEmailFromDocumentInfoIdpCookies.mockReturnValue('cookie@example.com');

      mockGasketConfig = {
        ...defaultTestConfig,
        auth: {
          ...defaultTestConfig.auth,
          isJWT: true,
          isMock: false,
        },
      };

      const gasketConfigModule = await import('@/lib/gasket-config');
      vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(true);
      vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(false);

      const gasketAuth = await import('@godaddy/gasket-auth');
      vi.mocked(gasketAuth.useAuthState).mockReturnValue({
        status: 'loaded',
        valid: true,
        details: { shopperId: 'shopper-1', cid: 'customer-1' },
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.getUserEmail()).toBe('cookie@example.com');
        expect(result.current.getUserInfo().email).toBe('cookie@example.com');
      });
      expect(mockGetEmailFromDocumentInfoIdpCookies).toHaveBeenCalled();
    });
  });

});
