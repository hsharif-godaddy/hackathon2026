// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useUploadedMedia } from './useUploadedMedia';

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

const file = (overrides: Record<string, unknown>) => ({
  id: 'id',
  filename: 'f.jpg',
  originalName: 'F',
  mimeType: 'image/jpeg',
  size: 10,
  ...overrides,
});

describe('useUploadedMedia', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters to image/video files and computes a cache-busted full signed URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          file({ filename: 'a.jpg', mimeType: 'image/jpeg', signedUrl: '/files/uploads/app-123/a.jpg?sig=x' }),
          file({ filename: 'doc.pdf', mimeType: 'application/pdf', signedUrl: '/files/uploads/app-123/doc.pdf' }),
        ],
      }),
    });

    const { result } = renderHook(() => useUploadedMedia('app-123'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.uploads).toHaveLength(1);
    const [img] = result.current.uploads;
    expect(img.filename).toBe('a.jpg');
    // base agent URL prepended, query already present so '&' joins the cache-bust param
    expect(img.fullSignedUrl).toMatch(/^https:\/\/agent\.example\.com\/files\/uploads\/app-123\/a\.jpg\?sig=x&_t=\d+$/);
  });

  it('preserves the source marker on crawled uploads', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [file({ filename: 'c.png', mimeType: 'image/png', signedUrl: '/files/uploads/app-123/c.png', source: 'crawled' })],
      }),
    });

    const { result } = renderHook(() => useUploadedMedia('app-123'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.uploads[0]?.source).toBe('crawled');
  });

  it('sets an error and empties the list on a failed fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useUploadedMedia('app-123'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.uploads).toHaveLength(0);
  });
});
