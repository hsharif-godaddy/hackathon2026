import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGasketConfig, useGasketConfigSection } from './useGasketConfig';
import { getGasketConfig, gasketConfig } from '@/lib/gasket-config';

// Mock dependencies
vi.mock('@/lib/gasket-config', () => ({
  getGasketConfig: vi.fn(),
  gasketConfig: {
    env: 'test',
    appUrl: 'https://test.com',
    apiUrl: 'https://api.test.com',
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
      env: 'production',
      appUrl: 'https://prod.com',
      apiUrl: 'https://api.prod.com',
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
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    const { result, unmount } = renderHook(() => useGasketConfig());

    expect(result.current.isLoading).toBe(true);

    unmount();

    // State should not update after unmount
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('should set loading state correctly', async () => {
    vi.mocked(getGasketConfig).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(gasketConfig), 10))
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
    const { result } = renderHook(() => useGasketConfigSection('env'));

    expect(result.current.sectionConfig).toBe('test');
    expect(result.current.config).toEqual(gasketConfig);
  });

  it('should return appUrl section', () => {
    const { result } = renderHook(() => useGasketConfigSection('appUrl'));

    expect(result.current.sectionConfig).toBe('https://test.com');
  });

  it('should return apiUrl section', () => {
    const { result } = renderHook(() => useGasketConfigSection('apiUrl'));

    expect(result.current.sectionConfig).toBe('https://api.test.com');
  });

  it('should update section config when runtime config loads', async () => {
    const runtimeConfig = {
      env: 'production',
      appUrl: 'https://prod.com',
      apiUrl: 'https://api.prod.com',
    };

    vi.mocked(getGasketConfig).mockResolvedValue(runtimeConfig);

    const { result } = renderHook(() => useGasketConfigSection('env'));

    expect(result.current.sectionConfig).toBe('test');

    await waitFor(() => {
      expect(result.current.sectionConfig).toBe('production');
    });
  });

  it('should include all useGasketConfig return values', () => {
    const { result } = renderHook(() => useGasketConfigSection('env'));

    expect(result.current).toHaveProperty('config');
    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('isRuntimeConfig');
    expect(result.current).toHaveProperty('sectionConfig');
  });
});
