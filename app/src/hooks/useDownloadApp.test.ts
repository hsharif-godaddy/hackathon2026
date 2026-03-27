/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useDownloadApp } from './useDownloadApp';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

const mockAppFetch = vi.mocked((await import('@/lib/gasket-config')).appFetch);
const mockGlobalFetch = vi.fn();
global.fetch = mockGlobalFetch;

describe('useDownloadApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup DOM
    if (!document.body) {
      const body = document.createElement('body');
      Object.defineProperty(document, 'body', {
        value: body,
        writable: true,
      });
    }

    // Reset URL.createObjectURL mock
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();

    // Mock document methods
    const originalAppendChild = document.body.appendChild.bind(document.body);
    const originalRemoveChild = document.body.removeChild.bind(document.body);
    document.body.appendChild = vi.fn(originalAppendChild);
    document.body.removeChild = vi.fn(originalRemoveChild);
  });

  it('should initialize with correct default state', function initState() {
    const { result } = renderHook(() => useDownloadApp('test-app-id'));

    expect(result.current.isDownloading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.download).toBeDefined();
  });

  it('should get download URL and fetch directly from agent', async function downloadFile() {
    // Step 1: API returns download URL and token
    const apiResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        downloadUrl: 'https://agent.example.com/apps/test-app-id/zip',
        token: 'agent-jwt-token',
        filename: 'test-app.zip',
        tracked: true,
        exportId: 'export-123',
      }),
    } as unknown as Response;

    // Step 2: Agent returns zip file
    const mockBlob = new Blob(['test content'], { type: 'application/zip' });
    const agentResponse = {
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
    } as unknown as Response;

    mockAppFetch.mockResolvedValueOnce(apiResponse);
    mockGlobalFetch.mockResolvedValueOnce(agentResponse);

    const { result } = renderHook(() => useDownloadApp('test-app-id'));

    expect(result.current.isDownloading).toBe(false);

    act(() => {
      result.current.download();
    });

    // Should be downloading
    await waitFor(() => {
      expect(result.current.isDownloading).toBe(true);
    });

    // Wait for download to complete
    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
    });

    // Verify API was called to get download URL
    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/apps/test-app-id/download',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    // Verify agent was called directly with token
    expect(mockGlobalFetch).toHaveBeenCalledWith(
      'https://agent.example.com/apps/test-app-id/zip',
      expect.objectContaining({
        method: 'GET',
        headers: { 'Authorization': 'Bearer agent-jwt-token' },
      })
    );

    expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(result.current.error).toBeNull();
  });

  it('should handle untracked downloads (legacy sites)', async function untrackedDownload() {
    const apiResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        downloadUrl: 'https://agent.example.com/apps/legacy-app-id/zip',
        token: 'agent-jwt-token',
        filename: 'legacy-app.zip',
        tracked: false,
      }),
    } as unknown as Response;

    const mockBlob = new Blob(['test content'], { type: 'application/zip' });
    const agentResponse = {
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
    } as unknown as Response;

    mockAppFetch.mockResolvedValueOnce(apiResponse);
    mockGlobalFetch.mockResolvedValueOnce(agentResponse);

    const { result } = renderHook(() => useDownloadApp('legacy-app-id'));

    await act(async () => {
      await result.current.download();
    });

    // Download should succeed even if not tracked
    expect(result.current.isDownloading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
  });

  it('should handle API error response', async function apiError() {
    const mockResponse = {
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({ error: 'Site not found' }),
    } as unknown as Response;

    mockAppFetch.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useDownloadApp('non-existent-app'));

    await act(async () => {
      try {
        await result.current.download();
      } catch {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
      expect(result.current.error).toBe('Site not found');
    });

    // Agent should NOT be called if API fails
    expect(mockGlobalFetch).not.toHaveBeenCalled();
  });

  it('should handle agent error response', async function agentError() {
    const apiResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        downloadUrl: 'https://agent.example.com/apps/test-app-id/zip',
        token: 'agent-jwt-token',
        filename: 'test-app.zip',
        tracked: true,
      }),
    } as unknown as Response;

    const agentResponse = {
      ok: false,
      status: 500,
    } as unknown as Response;

    mockAppFetch.mockResolvedValueOnce(apiResponse);
    mockGlobalFetch.mockResolvedValueOnce(agentResponse);

    const { result } = renderHook(() => useDownloadApp('test-app-id'));

    await act(async () => {
      try {
        await result.current.download();
      } catch {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
      expect(result.current.error).toBe('Download failed: 500');
    });
  });

  it('should handle paywall error (403)', async function paywallError() {
    const mockResponse = {
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({
        error: 'Download requires Paid subscription',
        details: 'No active subscription',
      }),
    } as unknown as Response;

    mockAppFetch.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useDownloadApp('paid-app'));

    await act(async () => {
      try {
        await result.current.download();
      } catch {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(result.current.error).toBe('No active subscription');
    });
  });

  it('should handle network error', async function networkError() {
    mockAppFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useDownloadApp('test-app-id'));

    await act(async () => {
      try {
        await result.current.download();
      } catch {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
      expect(result.current.error).toBe('Network error');
    });
  });

  it('should use filename from API response', async function useApiFilename() {
    const apiResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        downloadUrl: 'https://agent.example.com/apps/test-app-id/zip',
        token: 'agent-jwt-token',
        filename: 'My-Custom-App.zip',
        tracked: true,
      }),
    } as unknown as Response;

    const mockBlob = new Blob(['test'], { type: 'application/zip' });
    const agentResponse = {
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
    } as unknown as Response;

    mockAppFetch.mockResolvedValueOnce(apiResponse);
    mockGlobalFetch.mockResolvedValueOnce(agentResponse);

    const { result } = renderHook(() => useDownloadApp('test-app-id'));

    const createElementSpy = vi.spyOn(document, 'createElement');

    await act(async () => {
      await result.current.download();
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
    });

    // Verify link element was created with correct filename from API
    expect(createElementSpy).toHaveBeenCalledWith('a');
    const createdElement = createElementSpy.mock.results[0]?.value as HTMLAnchorElement;
    expect(createdElement?.download).toBe('My-Custom-App.zip');
  });

  it('should throw error when appId is null', async function nullAppId() {
    const { result } = renderHook(() => useDownloadApp(null));

    await expect(result.current.download()).rejects.toThrow('App ID is required for download');
  });

  it('should cleanup resources on unmount', async function cleanup() {
    const apiResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        downloadUrl: 'https://agent.example.com/apps/test-app-id/zip',
        token: 'agent-jwt-token',
        filename: 'test-app.zip',
        tracked: true,
      }),
    } as unknown as Response;

    const mockBlob = new Blob(['test'], { type: 'application/zip' });
    const agentResponse = {
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
    } as unknown as Response;

    mockAppFetch.mockResolvedValueOnce(apiResponse);
    mockGlobalFetch.mockResolvedValueOnce(agentResponse);

    const { result, unmount } = renderHook(() => useDownloadApp('test-app-id'));

    await act(async () => {
      await result.current.download();
    });

    unmount();

    // Verify cleanup happened
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });
});
