import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { waitFor } from '@testing-library/react';

import { buildAgentAppEndpointUrl, buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { mockURLMethods } from '@/tests/mocks';
import { renderHookWithProviders } from '@/tests/test-utils';
import { useAppThumbnail } from './useAppThumbnail';

vi.mock('@/config/dynamic-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/dynamic-api')>();
  return {
    ...actual,
    buildDynamicApiUrl: vi.fn(),
  };
});
vi.mock('@/lib/agent-fetch');

describe('useAppThumbnail', () => {
  const mockSiteId = 'test-site-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockURLMethods();
    vi.mocked(buildDynamicApiUrl).mockResolvedValue(`https://api.test/screenshot/${mockSiteId}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return loading state initially', () => {
    vi.mocked(agentFetch).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHookWithProviders(() => useAppThumbnail(mockSiteId));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });

  it('should return thumbnail URL on successful fetch', async () => {
    const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });

    vi.mocked(agentFetch).mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => mockBlob,
    } as Response);

    const { result } = renderHookWithProviders(() => useAppThumbnail(mockSiteId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBe('blob:mock-url');
    expect(result.current.isError).toBe(false);
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
  });

  it('should return null on 404 response', async () => {
    vi.mocked(agentFetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHookWithProviders(() => useAppThumbnail(mockSiteId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('should return null on other non-ok responses', async () => {
    vi.mocked(agentFetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHookWithProviders(() => useAppThumbnail(mockSiteId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('should call agentFetch with correct parameters', async () => {
    vi.mocked(agentFetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    renderHookWithProviders(() => useAppThumbnail(mockSiteId));

    await waitFor(() => {
      expect(buildDynamicApiUrl).toHaveBeenCalledWith('screenshot', mockSiteId);
    });

    expect(agentFetch).toHaveBeenCalledWith(
      `https://api.test/screenshot/${mockSiteId}`,
      {
        method: 'GET',
        siteId: mockSiteId,
      }
    );
  });

  it('should not fetch when disabled', () => {
    renderHookWithProviders(() => useAppThumbnail(mockSiteId, false));

    expect(agentFetch).not.toHaveBeenCalled();
  });

  it('should not fetch when siteId is empty', () => {
    renderHookWithProviders(() => useAppThumbnail(''));

    expect(agentFetch).not.toHaveBeenCalled();
  });

  it('should use correct query key', async () => {
    vi.mocked(agentFetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHookWithProviders(() => useAppThumbnail(mockSiteId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(agentFetch).toHaveBeenCalledTimes(1);
  });

  it('should skip buildDynamicApiUrl when agentUrl is provided', async () => {
    const agentBase = 'https://agent.test';
    vi.mocked(agentFetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHookWithProviders(() => useAppThumbnail(mockSiteId, true, agentBase));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(buildDynamicApiUrl).not.toHaveBeenCalled();
    expect(agentFetch).toHaveBeenCalledWith(
      buildAgentAppEndpointUrl(agentBase, mockSiteId, 'screenshot'),
      {
        method: 'GET',
        siteId: mockSiteId,
      }
    );
  });

  it('should treat whitespace-only agentUrl as missing', async () => {
    vi.mocked(agentFetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHookWithProviders(() => useAppThumbnail(mockSiteId, true, '  \t  '));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(buildDynamicApiUrl).toHaveBeenCalledWith('screenshot', mockSiteId);
  });
});
