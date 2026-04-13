/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

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
}));

const mockUploadedImagesSection = vi.fn();
vi.mock('@/app/develop/components/media/UploadedImagesSection', () => ({
  UploadedImagesSection: (props: { onSelectImage: (file: { filename: string }) => void; appId: string; isDisabled?: boolean; layout?: string; selectedFilename?: string | null }) => {
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

const mockLogImpressionEvent = vi.fn(() => vi.fn());
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
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
    expect(screen.getByText('builder_mediaslot_upload')).toBeInTheDocument();
    expect(screen.getByText('builder_mediaslot_use_image')).toBeInTheDocument();
  });

  it('handles swap image flow', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { user } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);
    
    // Select an alternative image
    const images = screen.getAllByRole('button', { pressed: false });
    await user.click(images[0]); // Click the first unselected image
    
    // Click use image
    const useButton = screen.getByText('builder_mediaslot_use_image');
    await user.click(useButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'https://agent.example.com/media/app-123/slots/hero/image',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ newUrl: '/img2.jpg' }),
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
    
    const images = screen.getAllByRole('button', { pressed: false });
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
