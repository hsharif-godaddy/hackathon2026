/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { useMediaManifest } from '@/hooks/useMediaManifest';
import { useMediaSlot } from '@/hooks/useMediaSlot';
import { renderWithProviders } from '@/tests/test-utils';
import { MediaSlotDetail } from './MediaSlotDetail';

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

vi.mock('@/app/develop/components/media/UploadedImagesSection', () => ({
  UploadedImagesSection: ({ onSelectImage }: { onSelectImage: (file: { filename: string }) => void }) => (
    <div data-testid="uploaded-images-section">
      <button onClick={() => onSelectImage({ filename: 'test.jpg' })}>
        Select Uploaded Image
      </button>
    </div>
  ),
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

  it('handles select from uploads flow', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['test'], { type: 'image/jpeg' }),
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { user } = renderWithProviders(
      <MediaSlotDetail appId={mockAppId} slotName={mockSlotName} onDone={mockOnDone} />
    );

    const selectUploadBtn = screen.getByText('Select Uploaded Image');
    await user.click(selectUploadBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'https://agent.example.com/files/uploads/app-123/test.jpg',
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'https://agent.example.com/media/app-123/slots/hero/image/upload',
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(mockOnDone).toHaveBeenCalled();
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('uploads.mediaslot.success');
    });
  });

  it('handles select from uploads error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const { user } = renderWithProviders(<MediaSlotDetail appId={mockAppId} slotName={mockSlotName} />);

    const selectUploadBtn = screen.getByText('Select Uploaded Image');
    await user.click(selectUploadBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch uploaded file')).toBeInTheDocument();
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('uploads.mediaslot.failed');
    });
  });
});
