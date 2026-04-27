import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';

import { useAuth } from './useAuth';

// Mock dependencies
vi.mock('@godaddy/gasket-auth', () => ({
  useAuthState: vi.fn(() => ({
    status: 'authenticated',
    valid: true,
    details: { email: 'test@example.com', cid: 'customer-123' },
  })),
  AuthRealmType: {},
  AuthRiskType: {},
  AuthIdpType: {},
}));

vi.mock('@/hooks/useMockAuth', () => ({
  useMockAuth: vi.fn(() => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
  })),
}));

vi.mock('@/lib/features', () => ({
  auth: {
    getType: vi.fn(() => 'MOCK'),
    isMock: vi.fn(() => true),
    isJWT: vi.fn(() => false),
  },
  authUtils: {
    getSupportedAuthTypes: vi.fn(() => ['sso']),
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
  getGasketConfig: vi.fn(() => Promise.resolve(mockGasketConfig)),
  getLoginUrl: vi.fn((returnUrl?: string) =>
    Promise.resolve(`${mockGasketConfig.sso.loginUrl}?app=airo-builder${returnUrl ? `&path=${encodeURIComponent(returnUrl)}` : ''}`)
  ),
  getLogoutUrl: vi.fn(() => {
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
  isAuthMockSync: vi.fn(() => true),
  isAuthJWTSync: vi.fn(() => false),
  getAuthTypeSync: vi.fn(() => 'MOCK'),
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
  const useAuthUIStore: any = vi.fn((selector?: (state: typeof store) => any) => {
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
    vi.mocked(gasketConfigModule.getGasketConfig).mockImplementation(() => Promise.resolve(mockGasketConfig));
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

});
