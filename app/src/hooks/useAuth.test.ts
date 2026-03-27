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
  authFetch: vi.fn(),
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
    isDisabled: vi.fn(() => false),
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
    isDisabled: false,
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
  getLoginUrl: vi.fn((returnUrl?: string) => {
    const redirect = returnUrl || mockGasketConfig.redirects.loginRedirectUrl;
    return Promise.resolve(`${mockGasketConfig.sso.loginUrl}?app=airo-builder&redirect=${encodeURIComponent(redirect)}`);
  }),
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
  isAuthDisabledSync: vi.fn(() => false),
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

const { mockClearNeedsReauth, mockStore, mockUseAuthUIStore } = vi.hoisted(() => {
  const clearFn = vi.fn();
  const store = {
    needsReauthSeq: 0,
    needsReauth: false,
    clearNeedsReauth: (expectedSeq?: number) => {
      clearFn(expectedSeq);
      // Only clear if sequence hasn't advanced (same logic as real store)
      if (expectedSeq !== undefined && expectedSeq !== store.needsReauthSeq) {
        return; // No-op on sequence mismatch
      }
      store.needsReauth = false;
    },
    setNeedsReauth: (_reason: string) => {
      store.needsReauthSeq++;
      store.needsReauth = true;
    }
  };

  const useAuthUIStore: any = vi.fn((selector: (state: typeof store) => any) => {
    return selector(store);
  });
  useAuthUIStore.getState = () => store;

  return {
    mockClearNeedsReauth: clearFn,
    mockStore: store,
    mockUseAuthUIStore: useAuthUIStore,
  };
});

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: mockUseAuthUIStore,
}));

describe('useAuth', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mock store to initial state
    mockStore.needsReauthSeq = 0;
    mockStore.needsReauth = false;

    // Reset gasket config mock to default
    mockGasketConfig = { ...defaultTestConfig };

    // Reset getGasketConfig mock implementation
    const gasketConfigModule = await import('@/lib/gasket-config');
    vi.mocked(gasketConfigModule.getGasketConfig).mockImplementation(() => Promise.resolve(mockGasketConfig));
    vi.mocked(gasketConfigModule.isAuthDisabledSync).mockReturnValue(false);
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

  it('should clear needsReauth flag when JWT validation succeeds', async () => {
    // Test the NEW validation cycle tracking logic:
    // 1. needsReauth is set (401 occurred)
    // 2. Gasket Auth runs validation (status='loading')
    // 3. Validation completes with valid=true
    // 4. needsReauth should be cleared

    const { useAuthState } = await import('@godaddy/gasket-auth');
    const gasketConfigModule = await import('@/lib/gasket-config');

    // Configure gasket-config mocks for JWT mode
    vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(true);
    vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(false);

    // Set JWT config
    mockGasketConfig = {
      ...defaultTestConfig,
      auth: { ...defaultTestConfig.auth, authType: 'JWT', isMock: false, isJWT: true },
    };
    vi.mocked(gasketConfigModule.getGasketConfig).mockResolvedValue(mockGasketConfig);

    // Mock Gasket Auth to simulate validation cycle
    let authStateValue = {
      status: 'authenticated' as const,
      valid: true,
      details: { email: 'test@example.com', cid: 'customer-123' },
    };
    vi.mocked(useAuthState).mockImplementation(() => authStateValue);

    const { rerender } = renderHook(() => useAuth());

    // Wait for config to load
    await waitFor(() => {
      expect(gasketConfigModule.getGasketConfig).toHaveBeenCalled();
    });

    // Simulate a 401 error that sets needsReauth
    mockStore.setNeedsReauth('session_expired');
    expect(mockStore.needsReauth).toBe(true);
    expect(mockStore.needsReauthSeq).toBe(1);

    // Simulate Gasket Auth starting a validation cycle
    authStateValue = { ...authStateValue, status: 'loading' };
    rerender();

    // Wait for validation cycle to be detected
    await waitFor(() => {
      // The effect should detect status='loading' and track the sequence
    });

    // Simulate validation completing with valid=true
    authStateValue = { ...authStateValue, status: 'authenticated', valid: true };
    rerender();

    // Wait for needsReauth to be cleared
    await waitFor(() => {
      expect(mockClearNeedsReauth).toHaveBeenCalled();
    });

    // Verify it was called with the correct sequence
    expect(mockClearNeedsReauth).toHaveBeenCalledWith(1);
    expect(mockStore.needsReauth).toBe(false);
  });

  it('should not clear needsReauth flag when JWT validation fails', async () => {
    // Test that needsReauth stays set when validation cycle completes with valid=false
    // 1. needsReauth is set (401 occurred)
    // 2. Gasket Auth runs validation (status='loading')
    // 3. Validation completes with valid=false
    // 4. needsReauth should NOT be cleared (user still needs to reauth)

    const { useAuthState } = await import('@godaddy/gasket-auth');
    const gasketConfigModule = await import('@/lib/gasket-config');

    // Configure gasket-config mocks for JWT mode
    vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(true);
    vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(false);

    // Set JWT config
    mockGasketConfig = {
      ...defaultTestConfig,
      auth: { ...defaultTestConfig.auth, authType: 'JWT', isMock: false, isJWT: true },
    };
    vi.mocked(gasketConfigModule.getGasketConfig).mockResolvedValue(mockGasketConfig);

    // Mock Gasket Auth with invalid token
    let authStateValue = {
      status: 'authenticated' as const,
      valid: false,
      details: { email: 'test@example.com', cid: 'customer-123' },
    };
    vi.mocked(useAuthState).mockImplementation(() => authStateValue);

    const { rerender } = renderHook(() => useAuth());

    // Wait for config to load
    await waitFor(() => {
      expect(gasketConfigModule.getGasketConfig).toHaveBeenCalled();
    });

    // Simulate a 401 error that sets needsReauth
    mockStore.setNeedsReauth('session_expired');
    expect(mockStore.needsReauth).toBe(true);

    // Simulate Gasket Auth starting a validation cycle
    authStateValue = { ...authStateValue, status: 'loading' };
    rerender();

    // Simulate validation completing with valid=false (token is invalid)
    authStateValue = { ...authStateValue, status: 'authenticated', valid: false };
    rerender();

    // Give it time to potentially call clearNeedsReauth (which it shouldn't)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify needsReauth was NOT cleared because valid=false
    expect(mockClearNeedsReauth).not.toHaveBeenCalled();
    expect(mockStore.needsReauth).toBe(true);
  });

  it('should not clear needsReauth if sequence advanced during validation', async () => {
    // Test sequence-based race condition protection:
    // 1. needsReauth is set with seq=1 (401 #1)
    // 2. Gasket Auth runs validation cycle (status='loading') - captures seq=1
    // 3. Another 401 occurs, advancing seq to 2 (401 #2)
    // 4. First validation completes with valid=true
    // 5. needsReauth should NOT be cleared because sequence doesn't match (captured seq=1, current seq=2)

    const { useAuthState } = await import('@godaddy/gasket-auth');
    const gasketConfigModule = await import('@/lib/gasket-config');

    // Configure gasket-config mocks for JWT mode
    vi.mocked(gasketConfigModule.isAuthJWTSync).mockReturnValue(true);
    vi.mocked(gasketConfigModule.isAuthMockSync).mockReturnValue(false);

    // Set JWT config
    mockGasketConfig = {
      ...defaultTestConfig,
      auth: { ...defaultTestConfig.auth, authType: 'JWT', isMock: false, isJWT: true },
    };
    vi.mocked(gasketConfigModule.getGasketConfig).mockResolvedValue(mockGasketConfig);

    let authStateValue = {
      status: 'authenticated' as const,
      valid: true,
      details: { email: 'test@example.com', cid: 'customer-123' },
    };
    vi.mocked(useAuthState).mockImplementation(() => authStateValue);

    const { rerender } = renderHook(() => useAuth());

    // Wait for config to load
    await waitFor(() => {
      expect(gasketConfigModule.getGasketConfig).toHaveBeenCalled();
    });

    // Simulate first 401 error (seq=1)
    mockStore.setNeedsReauth('session_expired');
    expect(mockStore.needsReauth).toBe(true);
    expect(mockStore.needsReauthSeq).toBe(1);

    // Simulate Gasket Auth starting validation cycle - captures seq=1
    authStateValue = { ...authStateValue, status: 'loading' };
    rerender();

    // Wait for validation cycle to be detected with seq=1
    await waitFor(() => {
      // The effect detects status='loading' and captures needsReauthSeq=1
    });

    // Simulate another 401 while validation is in progress (seq advances to 2)
    mockStore.setNeedsReauth('another_401');
    expect(mockStore.needsReauthSeq).toBe(2);

    // Simulate validation completing with valid=true (but for the OLD seq=1)
    authStateValue = { ...authStateValue, status: 'authenticated', valid: true };
    rerender();

    // Give it time to potentially call clearNeedsReauth
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify needsReauth was NOT cleared due to sequence mismatch
    // The validation was for seq=1 but current seq is 2
    expect(mockStore.needsReauth).toBe(true);
    expect(mockStore.needsReauthSeq).toBe(2);

    // clearNeedsReauth may have been called with seq=1, but the store's
    // clearNeedsReauth implementation should have rejected it due to mismatch
    if (mockClearNeedsReauth.mock.calls.length > 0) {
      // If called, verify it was rejected (needsReauth still true)
      expect(mockStore.needsReauth).toBe(true);
    }
  });
});
