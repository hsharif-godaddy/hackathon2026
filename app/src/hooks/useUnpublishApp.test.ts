import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';

const mockAppFetch = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
const mockFetchSite = vi.hoisted(() => vi.fn());
const mockFetchAllSites = vi.hoisted(() => vi.fn());

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: (state: { fetchSite: () => void }) => unknown) =>
    selector({ fetchSite: mockFetchSite }),
}));

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: (selector: (state: { fetchAllSites: () => void }) => unknown) =>
    selector({ fetchAllSites: mockFetchAllSites }),
}));

import { useUnpublishApp } from './useUnpublishApp';

/* eslint-disable react-hooks/rules-of-hooks */
describe('useUnpublishApp', function useUnpublishAppTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockFetchSite.mockResolvedValue({});
    mockFetchAllSites.mockResolvedValue({});
  });

  afterEach(function cleanup() {
    vi.resetAllMocks();
  });

  it('should expose mutation methods', function exposesMutation() {
    const { result } = renderHookWithProviders(() => useUnpublishApp());

    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });

  it('should successfully unpublish an app', async function unpublishSuccess() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'App unpublished' }),
    });

    const { result } = renderHookWithProviders(() => useUnpublishApp());

    await act(async function performMutation() {
      result.current.mutate({ appId: 'app-123' });
    });

    await waitFor(function waitForSuccess() {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockAppFetch).toHaveBeenCalledWith('/api/apps/app-123/unpublish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disconnectDomain: undefined, domainFqdn: undefined }),
    });
  });

  it('should pass disconnectDomain option', async function passesDisconnectDomain() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'App unpublished' }),
    });

    const { result } = renderHookWithProviders(() => useUnpublishApp());

    await act(async function performMutation() {
      result.current.mutate({
        appId: 'app-123',
        disconnectDomain: true,
        domainFqdn: 'example.com',
      });
    });

    await waitFor(function waitForSuccess() {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockAppFetch).toHaveBeenCalledWith('/api/apps/app-123/unpublish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disconnectDomain: true, domainFqdn: 'example.com' }),
    });
  });

  it('should refetch sites on success', async function refetchesSites() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'App unpublished' }),
    });

    const { result } = renderHookWithProviders(() => useUnpublishApp());

    await act(async function performMutation() {
      result.current.mutate({ appId: 'app-123' });
    });

    await waitFor(function waitForSuccess() {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetchSite).toHaveBeenCalledWith('app-123', true);
    expect(mockFetchAllSites).toHaveBeenCalled();
  });

  it('should handle API error', async function handlesApiError() {
    mockAppFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Failed to unpublish', retryable: true }),
    });

    const { result } = renderHookWithProviders(() => useUnpublishApp());

    await act(async function performMutation() {
      result.current.mutate({ appId: 'app-123' });
    });

    await waitFor(function waitForError() {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Failed to unpublish');
    expect((result.current.error as any)?.retryable).toBe(true);
  });

  it('should log success on successful unpublish', async function logsSuccess() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'App unpublished' }),
    });

    const { result } = renderHookWithProviders(() => useUnpublishApp());

    await act(async function performMutation() {
      result.current.mutate({ appId: 'app-123' });
    });

    await waitFor(function waitForSuccess() {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockLogger.info).toHaveBeenCalledWith('unpublish.hook.start', {
      appId: 'app-123',
      disconnectDomain: undefined,
      domainFqdn: undefined,
    });
    expect(mockLogger.info).toHaveBeenCalledWith('unpublish.hook.success', {
      appId: 'app-123',
    });
  });

  it('should log error on failed unpublish', async function logsError() {
    mockAppFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error', retryable: true }),
    });

    const { result } = renderHookWithProviders(() => useUnpublishApp());

    await act(async function performMutation() {
      result.current.mutate({ appId: 'app-123' });
    });

    await waitFor(function waitForError() {
      expect(result.current.isError).toBe(true);
    });

    expect(mockLogger.error).toHaveBeenCalledWith('unpublish.hook.error', {
      appId: 'app-123',
      error: 'Server error',
      retryable: true,
    });
  });
});
