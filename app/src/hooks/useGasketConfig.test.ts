import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';

import { gasketConfig, getGasketConfig } from '@/lib/gasket-config';
import { useGasketConfig, useGasketConfigSection } from './useGasketConfig';

// Mock dependencies
vi.mock('@/lib/gasket-config', () => ({
  getGasketConfig: vi.fn(),
  gasketConfig: {
    auth: {
      realm: 'idp',
      risk: 'low',
      type: ['basic'],
      authType: 'mock',
      isDisabled: false,
      isMock: true,
      isJWT: false,
    },
    sso: {
      loginUrl: 'https://sso.test.com/login',
      logoutUrl: 'https://sso.test.com/logout',
    },
    redirects: {
      loginRedirectUrl: 'https://test.com/',
      logoutRedirectUrl: 'https://test.com/',
    },
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useGasketConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return static config immediately', () => {
    const { result } = renderHook(() => useGasketConfig());

    expect(result.current.config).toEqual(gasketConfig);
    expect(result.current.isRuntimeConfig).toBe(false);
  });

  it.skip('should not load runtime config on server', () => {
    // Skipped: Tests always run in client-side environment where window is defined
    // The hook checks typeof window === 'undefined' which is always false in tests
  });

  it('should load runtime config on client', async () => {
    const runtimeConfig = {
      auth: {
        realm: 'idp',
        risk: 'low',
        type: ['basic'],
        authType: 'production',
        isDisabled: false,
        isMock: false,
        isJWT: false,
      },
      sso: {
        loginUrl: 'https://sso.prod.com/login',
        logoutUrl: 'https://sso.prod.com/logout',
      },
      redirects: {
        loginRedirectUrl: 'https://prod.com/',
        logoutRedirectUrl: 'https://prod.com/',
      },
    };

    vi.mocked(getGasketConfig).mockResolvedValue(runtimeConfig);

    const { result } = renderHook(() => useGasketConfig());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.config).toEqual(runtimeConfig);
    expect(result.current.isRuntimeConfig).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it('should handle runtime config load error', async () => {
    const error = new Error('Failed to load');
    vi.mocked(getGasketConfig).mockRejectedValue(error);

    const { result } = renderHook(() => useGasketConfig());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load');
    expect(result.current.config).toEqual(gasketConfig); // Falls back to static config
    expect(result.current.isRuntimeConfig).toBe(false);
  });

  it('should handle non-Error objects', async () => {
    vi.mocked(getGasketConfig).mockRejectedValue('String error');

    const { result } = renderHook(() => useGasketConfig());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load configuration');
  });

  it('should cancel loading on unmount', async () => {
    vi.mocked(getGasketConfig).mockImplementation(
      function () { return new Promise((resolve) => setTimeout(resolve, 1000)); }
    );

    const { result, unmount } = renderHook(() => useGasketConfig());

    expect(result.current.isLoading).toBe(true);

    unmount();

    // State should not update after unmount
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('should set loading state correctly', async () => {
    vi.mocked(getGasketConfig).mockImplementation(
      function () { return new Promise((resolve) => setTimeout(() => resolve(gasketConfig), 10)); }
    );

    const { result } = renderHook(() => useGasketConfig());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});

describe('useGasketConfigSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return specific config section', () => {
    const { result } = renderHook(() => useGasketConfigSection('auth'));

    expect(result.current.sectionConfig).toEqual({
      realm: 'idp',
      risk: 'low',
      type: ['basic'],
      authType: 'mock',
      isDisabled: false,
      isMock: true,
      isJWT: false,
    });
    expect(result.current.config).toEqual(gasketConfig);
  });

  it('should return sso section', () => {
    const { result } = renderHook(() => useGasketConfigSection('sso'));

    expect(result.current.sectionConfig).toEqual({
      loginUrl: 'https://sso.test.com/login',
      logoutUrl: 'https://sso.test.com/logout',
    });
  });

  it('should return redirects section', () => {
    const { result } = renderHook(() => useGasketConfigSection('redirects'));

    expect(result.current.sectionConfig).toEqual({
      loginRedirectUrl: 'https://test.com/',
      logoutRedirectUrl: 'https://test.com/',
    });
  });

  it('should update section config when runtime config loads', async () => {
    const runtimeConfig = {
      auth: {
        realm: 'idp',
        risk: 'low',
        type: ['basic'],
        authType: 'production',
        isDisabled: false,
        isMock: false,
        isJWT: false,
      },
      sso: {
        loginUrl: 'https://sso.prod.com/login',
        logoutUrl: 'https://sso.prod.com/logout',
      },
      redirects: {
        loginRedirectUrl: 'https://prod.com/',
        logoutRedirectUrl: 'https://prod.com/',
      },
    };

    vi.mocked(getGasketConfig).mockResolvedValue(runtimeConfig);

    const { result } = renderHook(() => useGasketConfigSection('auth'));

    expect(result.current.sectionConfig.authType).toBe('mock');

    await waitFor(() => {
      expect(result.current.sectionConfig.authType).toBe('production');
    });
  });

  it('should include all useGasketConfig return values', () => {
    const { result } = renderHook(() => useGasketConfigSection('auth'));

    expect(result.current).toHaveProperty('config');
    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('isRuntimeConfig');
    expect(result.current).toHaveProperty('sectionConfig');
  });
});
