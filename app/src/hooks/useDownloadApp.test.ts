import { beforeEach,describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useDownloadApp } from './useDownloadApp';

// Mock dependencies
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn(),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn(),
  },
}));

const mockRegenerateToken = vi.mocked((await import('@/lib/jwt-regeneration')).regenerateToken);
const mockDynamicApiConfigService = vi.mocked((await import('@/config/dynamic-api')).dynamicApiConfigService);

describe('useDownloadApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks for JWT regeneration and API config
    mockRegenerateToken.mockResolvedValue({
      token: 'mock-jwt-token',
      expires: new Date(Date.now() + 43200000).toISOString(),
      siteId: 'test-site',
      type: 'jwt',
    });

    mockDynamicApiConfigService.getConfigForSite.mockResolvedValue({
      baseUrl: 'http://localhost:3000',
      wsUrl: 'ws://localhost:4000',
      agentUrl: 'http://localhost:4000',
      isStatic: false,
    });

    // Mock global fetch for agent service calls
    global.fetch = vi.fn();

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

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useDownloadApp());

    expect(result.current.isDownloading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.download).toBeDefined();
  });

  it('should successfully download a file', async () => {
    const mockBlob = new Blob(['test content'], { type: 'application/zip' });
    const mockResponse = {
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
      headers: new Headers({
        'Content-Disposition': 'attachment; filename="test-app.zip"',
      }),
    } as unknown as Response;

    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useDownloadApp());

    expect(result.current.isDownloading).toBe(false);

    act(() => {
      result.current.download('test-app-id');
    });

    // Should be downloading
    await waitFor(() => {
      expect(result.current.isDownloading).toBe(true);
    });

    // Wait for download to complete
    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
    });

    // Verify JWT was regenerated
    expect(mockRegenerateToken).toHaveBeenCalledWith({ siteId: 'test-app-id', force: true });

    // Verify API config was fetched
    expect(mockDynamicApiConfigService.getConfigForSite).toHaveBeenCalledWith('test-app-id');

    // Verify download was triggered with correct URL and auth header
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/apps/test-app-id/zip',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Authorization': 'Bearer mock-jwt-token',
        }),
      })
    );
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(result.current.error).toBeNull();
  });

  it('should handle API error response', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: vi.fn().mockResolvedValue({ error: 'App not found' }),
      headers: new Headers(),
    } as unknown as Response;

    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useDownloadApp());

    await act(async () => {
      try {
        await result.current.download('non-existent-app');
      } catch (error) {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
      expect(result.current.error).toBe('App not found');
    });
  });

  it('should handle network error', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useDownloadApp());

    await act(async () => {
      try {
        await result.current.download('test-app-id');
      } catch (error) {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
      expect(result.current.error).toBe('Network error');
    });
  });

  it('should extract filename from Content-Disposition header', async () => {
    const mockBlob = new Blob(['test'], { type: 'application/zip' });
    const mockResponse = {
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
      headers: new Headers({
        'Content-Disposition': 'attachment; filename="my-custom-app.zip"',
      }),
    } as unknown as Response;

    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useDownloadApp());

    const createElementSpy = vi.spyOn(document, 'createElement');

    await act(async () => {
      await result.current.download('test-app-id');
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
    });

    // Verify link element was created with correct filename
    expect(createElementSpy).toHaveBeenCalledWith('a');
    const createdElement = createElementSpy.mock.results[0]?.value as HTMLAnchorElement;
    expect(createdElement?.download).toBe('my-custom-app.zip');
  });

  it('should use fallback filename when Content-Disposition is missing', async () => {
    const mockBlob = new Blob(['test'], { type: 'application/zip' });
    const mockResponse = {
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
      headers: new Headers(),
    } as unknown as Response;

    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useDownloadApp());

    const createElementSpy = vi.spyOn(document, 'createElement');

    await act(async () => {
      await result.current.download('my-app-123');
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(false);
    });

    const createdElement = createElementSpy.mock.results[0]?.value as HTMLAnchorElement;
    expect(createdElement?.download).toBe('app-my-app-123.zip');
  });

  it('should handle detailed error messages', async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: vi.fn().mockResolvedValue({
        error: 'Download not allowed',
        details: 'This app does not have local files. Only local development apps can be downloaded.',
      }),
      headers: new Headers(),
    } as unknown as Response;

    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useDownloadApp());

    await act(async () => {
      try {
        await result.current.download('production-app');
      } catch (error) {
        // Expected
      }
    });

    await waitFor(() => {
      expect(result.current.error).toBe(
        'This app does not have local files. Only local development apps can be downloaded.'
      );
    });
  });

  it('should cleanup resources on unmount', async () => {
    const mockBlob = new Blob(['test'], { type: 'application/zip' });
    const mockResponse = {
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
      headers: new Headers(),
    } as unknown as Response;

    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

    const { result, unmount } = renderHook(() => useDownloadApp());

    await act(async () => {
      await result.current.download('test-app-id');
    });

    unmount();

    // Verify cleanup happened
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });
});
