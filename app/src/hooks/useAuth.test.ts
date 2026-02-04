import { beforeEach,describe, expect, it, vi } from 'vitest';
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
vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: {
    getState: () => mockStore,
  },
}));

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

  it('should clear needsReauth flag when JWT validation succeeds', async () => {
    // Mock JWT mode
    const { auth } = await import('@/lib/features');
    vi.mocked(auth.isJWT).mockReturnValue(true);
    vi.mocked(auth.isMock).mockReturnValue(false);

    // Mock successful validation response
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

      if (url === '/api/auth/validate') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            valid: true,
            payload: {
              shopperId: 'test-123',
              cid: 'customer-123',
            },
          }),
        } as Response);
      }

      return Promise.resolve({ ok: false } as Response);
    }) as any;

    renderHook(() => useAuth());

    // Wait for auth validation to complete
    await waitFor(() => {
      expect(mockClearNeedsReauth).toHaveBeenCalled();
    });
  });

  it('should not clear needsReauth flag when JWT validation fails', async () => {
    const { auth } = await import('@/lib/features');
    vi.mocked(auth.isJWT).mockReturnValue(true);
    vi.mocked(auth.isMock).mockReturnValue(false);

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

      if (url === '/api/auth/validate') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            valid: false,
          }),
        } as Response);
      }

      return Promise.resolve({ ok: false } as Response);
    }) as any;

    renderHook(() => useAuth());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/validate');
    });

    expect(mockClearNeedsReauth).not.toHaveBeenCalled();
  });

  it('should not clear needsReauth if sequence advanced during validation', async () => {
    // This test simulates the race condition:
    // 1. JWT validation starts with seq=0
    // 2. A concurrent 401 response increments seq to 1
    // 3. JWT validation completes and tries to clear with seq=0
    // 4. Clear should be a no-op because seq has advanced

    const { auth } = await import('@/lib/features');
    vi.mocked(auth.isJWT).mockReturnValue(true);
    vi.mocked(auth.isMock).mockReturnValue(false);

    // Track validation promises - we need to control ALL validation calls
    // because the useEffect runs again when configLoading changes
    let firstValidationResolve: (value: any) => void;
    let secondValidationResolve: (value: any) => void;
    let validationCallCount = 0;

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

      if (url === '/api/auth/validate') {
        validationCallCount++;
        // Return a new pending promise for each validation call
        // This allows us to control when each validation resolves
        if (validationCallCount === 1) {
          return new Promise((resolve) => {
            firstValidationResolve = resolve;
          });
        } else {
          // Second (and any subsequent) validation call - never resolve
          // This simulates the second validation still being in flight
          return new Promise((resolve) => {
            secondValidationResolve = resolve;
          });
        }
      }

      return Promise.resolve({ ok: false } as Response);
    }) as any;

    renderHook(() => useAuth());

    // Wait for the FIRST validation request to be made
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/validate');
    });

    // Simulate a concurrent 401 response that increments the sequence
    // This happens AFTER the first validation started (captured seq=0)
    // but BEFORE it completes
    mockStore.setNeedsReauth('session_expired');
    expect(mockStore.needsReauthSeq).toBe(1);
    expect(mockStore.needsReauth).toBe(true);

    // Now resolve the FIRST validation with success
    // This should call clearNeedsReauth(0) but it should be a no-op
    // because the sequence has advanced to 1
    firstValidationResolve!({
      ok: true,
      json: () => Promise.resolve({
        valid: true,
        payload: {
          shopperId: 'test-123',
          cid: 'customer-123',
        },
      }),
    });

    // Wait for the first validation to complete and call clearNeedsReauth
    await waitFor(() => {
      expect(mockClearNeedsReauth).toHaveBeenCalled();
    });

    // Verify clearNeedsReauth was called with the old sequence (0)
    // The first validation captured seq=0 before we called setNeedsReauth
    expect(mockClearNeedsReauth).toHaveBeenCalledWith(0);

    // Verify the clear was a no-op due to sequence mismatch
    // Since we passed expectedSeq=0 but mockStore.needsReauthSeq=1,
    // the mock's clearNeedsReauth should have detected the mismatch and NOT cleared
    expect(mockStore.needsReauthSeq).toBe(1); // Sequence hasn't changed
    expect(mockStore.needsReauth).toBe(true); // Flag still set (clear was no-op)
  });
});
