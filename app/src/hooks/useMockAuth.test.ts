import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';

import { mockAuthManager } from '@/lib/mock-auth';
import { useMockAuth } from './useMockAuth';

// Mock the mock-auth library
vi.mock('@/lib/mock-auth', () => ({
  mockAuthManager: {
    getState: vi.fn(),
    subscribe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    quickLogin: vi.fn(),
  },
}));

describe('useMockAuth', () => {
  const mockState = {
    isAuthenticated: false,
    user: null,
    isLoading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockAuthManager.getState).mockReturnValue(mockState);
    vi.mocked(mockAuthManager.subscribe).mockReturnValue(() => {});
  });

  it('should return initial state from mockAuthManager', () => {
    const { result } = renderHook(() => useMockAuth());

    expect(mockAuthManager.getState).toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBe(null);
    expect(result.current.isLoading).toBe(false);
  });

  it('should subscribe to state changes', () => {
    renderHook(() => useMockAuth());

    expect(mockAuthManager.subscribe).toHaveBeenCalled();
  });

  it('should unsubscribe on unmount', () => {
    const unsubscribe = vi.fn();
    vi.mocked(mockAuthManager.subscribe).mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useMockAuth());

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('should expose login method', () => {
    const { result } = renderHook(() => useMockAuth());

    expect(result.current.login).toBeDefined();
    expect(typeof result.current.login).toBe('function');
  });

  it('should expose logout method', () => {
    const { result } = renderHook(() => useMockAuth());

    expect(result.current.logout).toBeDefined();
    expect(typeof result.current.logout).toBe('function');
  });

  it('should expose quickLogin method', () => {
    const { result } = renderHook(() => useMockAuth());

    expect(result.current.quickLogin).toBeDefined();
    expect(typeof result.current.quickLogin).toBe('function');
  });

  it('should update state when subscription callback called', async () => {
    let subscriptionCallback: ((state: any) => void) | null = null;
    vi.mocked(mockAuthManager.subscribe).mockImplementation(function (callback) {
      subscriptionCallback = callback;
      return () => {};
    });

    const { result } = renderHook(() => useMockAuth());

    expect(result.current.isAuthenticated).toBe(false);

    // Simulate state change
    const newState = {
      isAuthenticated: true,
      user: { id: '123', name: 'Test User' },
      isLoading: false,
    };

    subscriptionCallback?.(newState);

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  it('should return authenticated state', () => {
    const authenticatedState = {
      isAuthenticated: true,
      user: { id: '123', name: 'Test User', email: 'test@example.com', plan: 'free' },
      isLoading: false,
    };

    vi.mocked(mockAuthManager.getState).mockReturnValue(authenticatedState);

    const { result } = renderHook(() => useMockAuth());

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ id: '123', name: 'Test User', email: 'test@example.com', plan: 'free' });
  });

  it('should return loading state', () => {
    const loadingState = {
      isAuthenticated: false,
      user: null,
      isLoading: true,
    };

    vi.mocked(mockAuthManager.getState).mockReturnValue(loadingState);

    const { result } = renderHook(() => useMockAuth());

    expect(result.current.isLoading).toBe(true);
  });
});
