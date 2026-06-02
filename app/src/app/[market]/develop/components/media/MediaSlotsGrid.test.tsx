/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { MediaSlotsGrid } from './MediaSlotsGrid';

const mockAppId = 'app-123';

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: any) => selector({
    getServerState: () => ({ url: 'https://preview.example.com' }),
  }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id) { return id; }),
}));

describe('MediaSlotsGrid', () => {
  const defaultProps = {
    manifest: {
      'slot-1': { currentUrl: '/img1.jpg', alternatives: [] },
      'slot-2': { currentUrl: '/airo-assets/uploads/img2.jpg', alternatives: [] },
    } as any,
    slotNames: ['slot-1', 'slot-2'],
    appId: mockAppId,
    isLoading: false,
    error: null,
    onSelectSlot: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeleton when isLoading is true', () => {
    const { container } = renderWithProviders(<MediaSlotsGrid {...defaultProps} isLoading={true} />);
    const skeletons = container.querySelectorAll('.ux-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders error state', () => {
    renderWithProviders(<MediaSlotsGrid {...defaultProps} error="Failed to load" />);
    expect(screen.getByText('builder_mediaslot_error_fail_load')).toBeInTheDocument();
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('renders empty state when manifest is null', () => {
    renderWithProviders(<MediaSlotsGrid {...defaultProps} manifest={null} />);
    expect(screen.getByText('builder_mediaslot_no_images')).toBeInTheDocument();
  });

  it('renders empty state when slotNames is empty', () => {
    renderWithProviders(<MediaSlotsGrid {...defaultProps} slotNames={[]} />);
    expect(screen.getByText('builder_mediaslot_no_images')).toBeInTheDocument();
  });

  it('renders slots correctly', () => {
    renderWithProviders(<MediaSlotsGrid {...defaultProps} />);
    expect(screen.getByText('Slot 1')).toBeInTheDocument();
    expect(screen.getByText('Slot 2')).toBeInTheDocument();
  });

  it('calls onSelectSlot when a slot is clicked', async () => {
    const { user } = renderWithProviders(<MediaSlotsGrid {...defaultProps} />);
    const slotButton = screen.getByText('Slot 1').closest('button');
    
    if (slotButton) {
      await user.click(slotButton);
      expect(defaultProps.onSelectSlot).toHaveBeenCalledWith('slot-1');
    } else {
      throw new Error('Slot button not found');
    }
  });

  it('constructs correct proxied URLs for external images', () => {
    const { container } = renderWithProviders(<MediaSlotsGrid {...defaultProps} />);
    const img = container.querySelector('img[alt="Slot 1"]') as HTMLImageElement;
    expect(img.src).toContain('https://preview.example.com/airo-assets/images/slot-1?src=%2Fimg1.jpg');
  });

  it('constructs correct direct URLs for uploaded images', () => {
    const { container } = renderWithProviders(<MediaSlotsGrid {...defaultProps} />);
    const img = container.querySelector('img[alt="Slot 2"]') as HTMLImageElement;
    expect(img.src).toContain('https://preview.example.com/airo-assets/uploads/img2.jpg');
  });
});
