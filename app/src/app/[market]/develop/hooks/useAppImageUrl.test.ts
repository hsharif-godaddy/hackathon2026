/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { useServerPollingStore as UseServerPollingStore } from '@/stores/useServerPollingStore';
import { useAppImageUrl } from './useAppImageUrl';

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-123'),
}));

const mockGetServerState = vi.fn();

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: vi.fn(function (selector: Parameters<typeof UseServerPollingStore>[0]) {
    return selector({ getServerState: mockGetServerState } as unknown as Parameters<typeof selector>[0]);
  }),
}));

describe('useAppImageUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('places the path before the share token query string', () => {
    mockGetServerState.mockReturnValue({ url: 'https://host.preview.c39.airoapp.ai?airoShareToken=abc' });

    const { result } = renderHook(() => useAppImageUrl('/images/photo.png'));

    expect(result.current).toBe('https://host.preview.c39.airoapp.ai/images/photo.png?airoShareToken=abc');
  });

  it('returns null for null input', () => {
    mockGetServerState.mockReturnValue({ url: 'https://host.preview.c39.airoapp.ai?airoShareToken=abc' });

    const { result } = renderHook(() => useAppImageUrl(null));

    expect(result.current).toBeNull();
  });

  it('returns absolute URLs as-is without modifying them', () => {
    mockGetServerState.mockReturnValue({ url: 'https://host.preview.c39.airoapp.ai?airoShareToken=abc' });

    const { result } = renderHook(() => useAppImageUrl('https://cdn.example.com/logo.png'));

    expect(result.current).toBe('https://cdn.example.com/logo.png');
  });

  it('returns relative URL unchanged when previewUrl is not available', () => {
    mockGetServerState.mockReturnValue(null);

    const { result } = renderHook(() => useAppImageUrl('/images/photo.png'));

    expect(result.current).toBe('/images/photo.png');
  });
});
