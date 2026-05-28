/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { ImageEditorPanel } from './ImageEditorPanel';

vi.mock('next/dynamic', () => ({
  default: () => function FilerobotMock() {
    return <div data-testid="filerobot-editor" />;
  },
}));

vi.mock('@airo/shared/media', () => ({
  AIRO_ASSET_UPLOADS_URL_PREFIX: '/files/uploads/',
}));

vi.mock('@ux/skeleton', () => ({
  default: () => <div data-testid="skeleton" />,
}));

vi.mock('@/hooks/useMediaSlot', () => ({
  useMediaSlot: () => ({
    slot: { currentUrl: 'https://example.com/img.jpg' },
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: () => ({ refetch: vi.fn() }),
}));

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (s: unknown) => unknown) =>
    selector({ getServerState: () => null }),
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/app/[market]/develop/components/media/MediaSlotDetail', () => ({
  getSlotImageUrl: (_slot: string, url: string) => url,
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: { getConfigForSite: vi.fn() },
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn(),
}));

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}));

interface FakeImage {
  onload?: () => void;
  onerror?: () => void;
  crossOrigin?: string;
  src: string;
}

describe('ImageEditorPanel', () => {
  let RealImage: typeof Image;
  const imageInstances: FakeImage[] = [];

  beforeEach(() => {
    imageInstances.length = 0;
    mockLogger.warn.mockClear();
    RealImage = window.Image;

    class StubImage implements FakeImage {
      onload?: () => void;
      onerror?: () => void;
      crossOrigin?: string;
      src = '';
      constructor() {
        imageInstances.push(this);
      }
    }
    // @ts-expect-error - jsdom Image override for tests
    window.Image = StubImage;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
    } as unknown as Response);
  });

  afterEach(() => {
    window.Image = RealImage;
  });

  it('renders the Filerobot editor once the source image loads', async () => {
    renderWithProviders(
      <ImageEditorPanel
        appId="app-1"
        slotName="hero"
        sourceUrl="https://example.com/ok.jpg"
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => expect(imageInstances.length).toBeGreaterThan(0));
    act(() => {
      imageInstances[0].onload?.();
    });

    expect(await screen.findByTestId('filerobot-editor')).toBeInTheDocument();
    expect(
      screen.queryByText('builder_mediaslot_editor_image_load_failed'),
    ).not.toBeInTheDocument();
  });

  it('shows the load-failed message instead of mounting Filerobot when retries are exhausted', async () => {
    renderWithProviders(
      <ImageEditorPanel
        appId="app-1"
        slotName="hero"
        sourceUrl="https://example.com/broken.jpg"
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Initial attempt + 3 retries = 4 total. Each retry is scheduled 500ms after the previous error.
    for (let attempt = 0; attempt < 4; attempt++) {
      await waitFor(() => expect(imageInstances.length).toBeGreaterThan(attempt));
      act(() => {
        imageInstances[attempt].onerror?.();
      });
    }

    expect(
      await screen.findByText('builder_mediaslot_editor_image_load_failed'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('filerobot-editor')).not.toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'media_slot_image_editor.load_failed',
      expect.objectContaining({ appId: 'app-1', slotName: 'hero' }),
    );
  });
});
