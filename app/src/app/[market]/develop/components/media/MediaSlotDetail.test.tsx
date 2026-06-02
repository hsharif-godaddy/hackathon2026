/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { getParentOrigin } from '@/components/security/allowed-frame-ancestors';
import { useIsEmbedded } from '@/hooks/useIsEmbedded';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import { useMediaSlot } from '@/hooks/useMediaSlot';
import { renderWithProviders } from '@/tests/test-utils';
import { formatSlotName, MediaSlotDetail } from './MediaSlotDetail';

const mockAppId = 'app-123';
const mockSlotName = 'hero/image';

vi.mock('@/hooks/useMediaSlot', () => ({
  useMediaSlot: vi.fn(),
}));

vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: vi.fn(),
}));

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: unknown) => (selector as (state: unknown) => unknown)({
    getServerState: () => ({ url: 'https://preview.example.com' }),
  }),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
}));

vi.mock('@/utils/image-compression', () => ({
  compressImageFile: vi.fn().mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' })),
}));

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
  isOriginAllowed: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ images: [], gettyIds: [], totalResults: 0 }),
  }),
}));

vi.mock('@/hooks/useIsEmbedded', () => ({
  useIsEmbedded: vi.fn().mockReturnValue(false),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn().mockReturnValue(true),
}));

vi.mock('@/components/security/allowed-frame-ancestors', () => ({
  getParentOrigin: vi.fn().mockReturnValue('https://dashboard.godaddy.com'),
}));


const mockUploadedImagesSection = vi.fn();
vi.mock('@/app/[market]/develop/components/media/UploadedMediaSection', () => ({
  UploadedMediaSection: (props: { onSelectImage: (file: { filename: string }) => void; appId: string; isDisabled?: boolean; layout?: string; selectedFilename?: string | null }) => {
    mockUploadedImagesSection(props);
    return (
      <div data-testid="uploaded-images-section">
        <button onClick={() => props.onSelectImage({ filename: 'test.jpg' })}>
          Select Uploaded Image
        </button>
      </div>
    );
  },
}));

 
const mockLogImpressionEvent: any = vi.fn(function () { return vi.fn(); });
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id: string) { return id; }),
  logImpressionEvent: (...args: unknown[]) => mockLogImpressionEvent(...args),
}));

describe('MediaSlotDetail', () => {
  const mockRefetch = vi.fn();
  const mockRefetchManifest = vi.fn();
  const mockOnDone = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadedImagesSection.mockClear();
    mockLogImpressionEvent.mockClear();
    global.fetch = vi.fn();
    
    vi.mocked(useMediaSlot).mockReturnValue({
      slot: {
        currentUrl: '/img1.jpg',
        alternatives: ['/img2.jpg'],
        mediaType: 'image',
        searchQuery: 'test query',
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMediaSlot>);

    vi.mocked(useMediaManifest).mockReturnValue({
      manifest: {
        'hero/image': { currentUrl: '/img1.jpg', alternatives: ['/img2.jpg'] },
      },
      refetch: mockRefetchManifest,
    } as unknown as ReturnType<typeof useMediaManifest>);
  });

  it('renders loading state', () => {
    vi.mocked(useMediaSlot).mockReturnValue({ isLoading: true, error: null, slot: null } as unknown as ReturnType<typeof useMediaSlot>);
    
    const { container } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);
    expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useMediaSlot).mockReturnValue({ isLoading: false, error: 'Failed to load slot', slot: null } as unknown as ReturnType<typeof useMediaSlot>);
    
    renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);
    expect(screen.getByText('builder_mediaslot_error_fail_load')).toBeInTheDocument();
    expect(screen.getByText('Failed to load slot')).toBeInTheDocument();
  });

  it('renders empty state when no images', () => {
    vi.mocked(useMediaSlot).mockReturnValue({ isLoading: false, error: null, slot: null } as unknown as ReturnType<typeof useMediaSlot>);
    
    renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);
    expect(screen.getByText('builder_mediaslot_no_images')).toBeInTheDocument();
  });

  it('renders slot details correctly', () => {
    renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);
    
    expect(screen.getByText('Hero Image')).toBeInTheDocument();
    expect(screen.getByText('test query')).toBeInTheDocument();
    expect(screen.getByText('builder_mediaslot_uploads')).toBeInTheDocument();
    expect(screen.getByText('builder_mediaslot_use_image')).toBeInTheDocument();
  });

  it('handles swap image flow', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { user } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

    // Select an alternative image (wait for search to complete before querying)
    const images = await screen.findAllByRole('button', { pressed: false });
    await user.click(images[0]); // Click the first unselected image

    // Click use image
    const useButton = screen.getByText('builder_mediaslot_use_image');
    await user.click(useButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'https://agent.example.com/media/app-123/slots/hero/image',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ newUrl: '/img2.jpg', isVideo: false }),
        })
      );
    });

    expect(mockRefetch).toHaveBeenCalled();
    expect(mockRefetchManifest).toHaveBeenCalled();
  });

  it('handles swap image error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Swap failed' }),
    });

    const { user } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

    const images = await screen.findAllByRole('button', { pressed: false });
    await user.click(images[0]);
    
    const useButton = screen.getByText('builder_mediaslot_use_image');
    await user.click(useButton);

    await waitFor(() => {
      expect(screen.getByText('Swap failed')).toBeInTheDocument();
    });
  });

  it('handles select-then-confirm flow for uploads via apply-upload', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { user } = renderWithProviders(
      <MediaSlotDetail appId={mockAppId} slotName={mockSlotName} onDone={mockOnDone} />
    );

    // Step 1: Click upload image to SELECT it (not upload yet)
    const selectUploadBtn = screen.getByText('Select Uploaded Image');
    await user.click(selectUploadBtn);

    // Step 2: Click "Use this image" to confirm and trigger apply-upload
    const useButton = screen.getByText('builder_mediaslot_use_image');
    await user.click(useButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'https://agent.example.com/media/app-123/slots/hero/image/apply-upload',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ filename: 'test.jpg' }),
        })
      );
      // After successful apply-upload, user stays on slot detail (no onDone navigation)
      expect(mockOnDone).not.toHaveBeenCalled();
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('uploads.mediaslot.success');
    });
  });

  it('handles apply-upload error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Upload file not found' }),
    });

    const { user } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

    // Select upload, then confirm
    const selectUploadBtn = screen.getByText('Select Uploaded Image');
    await user.click(selectUploadBtn);

    const useButton = screen.getByText('builder_mediaslot_use_image');
    await user.click(useButton);

    await waitFor(() => {
      expect(screen.getByText('Upload file not found')).toBeInTheDocument();
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('uploads.mediaslot.failed');
    });
  });

  describe('iframe postMessage buttons', () => {
    const mockLogoSlot = () => {
      vi.mocked(useMediaSlot).mockReturnValue({
        slot: {
          currentUrl: '/img1.jpg',
          alternatives: ['/img2.jpg'],
          mediaType: 'logo',
          searchQuery: 'brand logo',
        },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useMediaSlot>);
    };

    it('does not render buttons when not embedded', () => {
      vi.mocked(useIsEmbedded).mockReturnValue(false);
      mockLogoSlot();

      renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

      expect(screen.queryByText('builder_mediaslot_set_as_logo')).not.toBeInTheDocument();
    });

    it('does not render buttons for non-logo slots even when embedded', () => {
      vi.mocked(useIsEmbedded).mockReturnValue(true);
      // Default mock uses mediaType: 'image'

      renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

      expect(screen.queryByText('builder_mediaslot_set_as_logo')).not.toBeInTheDocument();
    });

    it('renders the set-as-logo button for logo slots when embedded', () => {
      vi.mocked(useIsEmbedded).mockReturnValue(true);
      mockLogoSlot();

      renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

      expect(screen.getByText('builder_mediaslot_set_as_logo')).toBeInTheDocument();
      expect(screen.queryByText('builder_mediaslot_add_to_library')).not.toBeInTheDocument();
    });

    it('sends set-as-logo postMessage with base64 data URL', async () => {
      vi.mocked(useIsEmbedded).mockReturnValue(true);
      mockLogoSlot();
      const postMessageSpy = vi.spyOn(window.parent, 'postMessage');
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['img'], { type: 'image/png' }),
      });

      const { user } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

      await user.click(screen.getByText('builder_mediaslot_set_as_logo'));

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledWith(
          { action: 'set-as-logo', sender: 'airo-hq', imageUrl: expect.stringContaining('data:') },
          'https://dashboard.godaddy.com'
        );
      });
      postMessageSpy.mockRestore();
    });

    it('falls back to raw URL when fetch fails', async () => {
      vi.mocked(useIsEmbedded).mockReturnValue(true);
      mockLogoSlot();
      const postMessageSpy = vi.spyOn(window.parent, 'postMessage');
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      const { user } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

      await user.click(screen.getByText('builder_mediaslot_set_as_logo'));

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledWith(
          { action: 'set-as-logo', sender: 'airo-hq', imageUrl: expect.any(String) },
          'https://dashboard.godaddy.com'
        );
      });
      const call = postMessageSpy.mock.calls[0][0] as { imageUrl: string };
      expect(call.imageUrl).not.toContain('data:');
      postMessageSpy.mockRestore();
    });

    it('does not send postMessage when parentOrigin is null', async () => {
      vi.mocked(useIsEmbedded).mockReturnValue(true);
      mockLogoSlot();
      vi.mocked(getParentOrigin).mockReturnValue(null);
      const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

      const { user } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

      await user.click(screen.getByText('builder_mediaslot_set_as_logo'));

      expect(postMessageSpy).not.toHaveBeenCalled();
      postMessageSpy.mockRestore();
    });
  });

  describe('logo/generated slot search isolation', () => {
    it('does not auto-search for logo slots even when searchQuery exists', async () => {
      const { agentFetch } = await import('@/lib/agent-fetch');

      vi.mocked(useMediaSlot).mockReturnValue({
        slot: {
          currentUrl: 'https://logos.example.com/logo1.png',
          alternatives: [
            'https://logos.example.com/logo2.png',
            'https://logos.example.com/logo3.png',
            'https://logos.example.com/logo4.png',
          ],
          mediaType: 'logo',
          searchQuery: 'Acme Corp',
        },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useMediaSlot>);

      renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName="logo/primary" />);

      // Wait a tick to allow effects to fire
      await waitFor(() => {
        expect(agentFetch).not.toHaveBeenCalled();
      });
    });

    it('shows all logo alternatives without pagination (no slice to 3)', async () => {
      vi.mocked(useMediaSlot).mockReturnValue({
        slot: {
          currentUrl: 'https://logos.example.com/logo1.png',
          alternatives: [
            'https://logos.example.com/logo2.png',
            'https://logos.example.com/logo3.png',
            'https://logos.example.com/logo4.png',
          ],
          mediaType: 'logo',
          searchQuery: 'Acme Corp',
        },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useMediaSlot>);

      renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName="logo/primary" />);

      // All alternatives should be rendered as grid buttons (not sliced to 3)
      const buttons = await screen.findAllByRole('button', { pressed: false });
      // 3 alternative images should appear as unselected buttons
      expect(buttons.length).toBeGreaterThanOrEqual(3);
    });

    it('does not auto-search for generated slots', async () => {
      const { agentFetch } = await import('@/lib/agent-fetch');

      vi.mocked(useMediaSlot).mockReturnValue({
        slot: {
          currentUrl: 'https://generated.example.com/img1.png',
          alternatives: ['https://generated.example.com/img2.png'],
          mediaType: 'generated',
          searchQuery: 'abstract background',
        },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useMediaSlot>);

      renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName="generated/bg" />);

      await waitFor(() => {
        expect(agentFetch).not.toHaveBeenCalled();
      });
    });
  });

});

describe('formatSlotName', () => {
  it('should strip pages prefix and capitalize segments', () => {
    expect(formatSlotName('pages/home/hero')).toBe('Home Hero');
  });

  it('should strip components prefix', () => {
    expect(formatSlotName('components/footer/logo')).toBe('Footer Logo');
  });

  it('should strip sections prefix', () => {
    expect(formatSlotName('sections/about/background')).toBe('About Background');
  });

  it('should strip layouts prefix', () => {
    expect(formatSlotName('layouts/header/site-logo')).toBe('Header Site logo');
  });

  it('should replace hyphens with spaces', () => {
    expect(formatSlotName('pages/home/hero-image')).toBe('Home Hero image');
  });

  it('should handle paths without known prefixes', () => {
    expect(formatSlotName('logo/primary')).toBe('Logo Primary');
  });

  it('should handle single segment', () => {
    expect(formatSlotName('hero')).toBe('Hero');
  });
});
