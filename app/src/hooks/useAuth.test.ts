import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockClearNeedsReauth = vi.fn();
const mockStore = {
  needsReauthSeq: 0,
  needsReauth: false,
  // Implement actual sequence check logic to verify race condition protection
  clearNeedsReauth: (expectedSeq?: number) => {
    mockClearNeedsReauth(expectedSeq);
    // Only clear if sequence hasn't advanced (same logic as real store)
    if (expectedSeq !== undefined && expectedSeq !== mockStore.needsReauthSeq) {
      return; // No-op on sequence mismatch
    }
    mockStore.needsReauth = false;
  },
  setNeedsReauth: (_reason: string) => {
    mockStore.needsReauthSeq++;
    mockStore.needsReauth = true;
  }
};
vi.mock('@/stores/useAuthUIStore', () => {
  const useAuthUIStore = (selector?: (state: typeof mockStore) => unknown) => {
    if (typeof selector === 'function') {
      return selector(mockStore);
    }
    return mockStore;
  };
  useAuthUIStore.getState = () => mockStore;
  return { useAuthUIStore };
});

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock store to initial state
    mockStore.needsReauthSeq = 0;
    mockStore.needsReauth = false;

    global.fetch = vi.fn((url) => {
      if (url === '/api/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
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
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false } as Response);
    }) as any;
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

  it('should treat needsReauth as unauthenticated for JWT mode', async () => {
    const { auth } = await import('@/lib/features');
    const { useAuthState } = await import('@godaddy/gasket-auth');
    vi.mocked(auth.isJWT).mockReturnValue(true);
    vi.mocked(auth.isMock).mockReturnValue(false);

    vi.mocked(useAuthState).mockImplementation(() => ({
      status: 'authenticated',
      valid: false,
      details: { email: 'test@example.com', cid: 'customer-123' },
    }));

    mockStore.needsReauth = true;

    global.fetch = vi.fn((url) => {
      if (url === '/api/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            auth: {
              realm: 'idp',
              risk: 'low',
              type: ['sso'],
              authType: 'JWT',
              isDisabled: false,
              isMock: false,
              isJWT: true,
            },
            sso: {
              loginUrl: 'https://sso.example.com/login',
              logoutUrl: 'https://sso.example.com/logout',
            },
            redirects: {
              loginRedirectUrl: 'https://app.example.com',
              logoutRedirectUrl: 'https://app.example.com/logout',
            },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false } as Response);
    }) as any;

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
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
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, statusText: 'Error' } as Response)
    ) as any;

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

  it('should clear needsReauth when auth becomes valid in JWT mode', async () => {
    const { auth } = await import('@/lib/features');
    const { useAuthState } = await import('@godaddy/gasket-auth');
    vi.mocked(auth.isJWT).mockReturnValue(true);
    vi.mocked(auth.isMock).mockReturnValue(false);

    let authValid = false;
    vi.mocked(useAuthState).mockImplementation(() => ({
      status: 'authenticated',
      valid: authValid,
      details: { email: 'test@example.com', cid: 'customer-123' },
    }));

    mockStore.needsReauth = true;

    const { rerender } = renderHook(() => useAuth());

    authValid = true;
    rerender();

    await waitFor(() => {
      expect(mockClearNeedsReauth).toHaveBeenCalledWith(mockStore.needsReauthSeq);
    });
  });

  it('should not clear needsReauth when auth remains invalid in JWT mode', async () => {
    const { auth } = await import('@/lib/features');
    const { useAuthState } = await import('@godaddy/gasket-auth');
    vi.mocked(auth.isJWT).mockReturnValue(true);
    vi.mocked(auth.isMock).mockReturnValue(false);

    vi.mocked(useAuthState).mockImplementation(() => ({
      status: 'authenticated',
      valid: false,
      details: { email: 'test@example.com', cid: 'customer-123' },
    }));

    mockStore.needsReauth = true;

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.configLoading).toBe(false);
    });

    await waitFor(() => {
      expect(mockClearNeedsReauth).not.toHaveBeenCalled();
    });
  });

  it('should not clear needsReauth when JWT mode is disabled', async () => {
    const { auth } = await import('@/lib/features');
    const { useAuthState } = await import('@godaddy/gasket-auth');
    vi.mocked(auth.isJWT).mockReturnValue(false);
    vi.mocked(auth.isMock).mockReturnValue(false);

    vi.mocked(useAuthState).mockImplementation(() => ({
      status: 'authenticated',
      valid: true,
      details: { email: 'test@example.com', cid: 'customer-123' },
    }));

    mockStore.needsReauth = true;

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.configLoading).toBe(false);
    });

    await waitFor(() => {
      expect(mockClearNeedsReauth).not.toHaveBeenCalled();
    });
  });

  it('should gate isAuthenticated when authState.valid is true but needsReauth is true (expired e2s token)', async () => {
    const { auth } = await import('@/lib/features');
    const { useAuthState } = await import('@godaddy/gasket-auth');
    vi.mocked(auth.isJWT).mockReturnValue(true);
    vi.mocked(auth.isMock).mockReturnValue(false);

    // Start with valid auth that's already been seen as valid (previousAuthValidRef = true)
    vi.mocked(useAuthState).mockImplementation(() => ({
      status: 'authenticated',
      valid: true,
      details: { email: 'test@example.com', cid: 'customer-123' },
    }));

    global.fetch = vi.fn((url) => {
      if (url === '/api/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            auth: {
              realm: 'idp',
              risk: 'low',
              type: ['sso'],
              authType: 'JWT',
              isDisabled: false,
              isMock: false,
              isJWT: true,
            },
            sso: {
              loginUrl: 'https://sso.example.com/login',
              logoutUrl: 'https://sso.example.com/logout',
            },
            redirects: {
              loginRedirectUrl: 'https://app.example.com',
              logoutRedirectUrl: 'https://app.example.com/logout',
            },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false } as Response);
    }) as any;

    // Start with authState.valid=true and no needsReauth (normal authenticated state)
    mockStore.needsReauth = false;
    const { result, rerender } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Verify initially authenticated
    expect(result.current.isAuthenticated).toBe(true);

    // Now simulate 401 response setting needsReauth=true while Gasket Auth still has stale valid=true
    mockStore.setNeedsReauth('session_expired');

    // Rerender to pick up needsReauth change
    rerender();

    // isAuthenticated should now be false even though authState.valid is still true
    expect(result.current.isAuthenticated).toBe(false);
  });
});
