import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import MediaPanel from './MediaPanel';

const mockAppId = 'app-123';

vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: () => mockAppId,
}));

vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: () => ({
    manifest: {
      'slot-1': { currentUrl: '/img1.jpg', alternatives: [] },
    },
    slotNames: ['slot-1'],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const mockMediaSlotDialogStore = {
  panelSlotName: null as string | null,
  clearPanelSlot: vi.fn(),
};

vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: (selector: unknown) => (selector as (state: unknown) => unknown)(mockMediaSlotDialogStore),
}));

vi.mock('@/app/develop/components/media/MediaSlotDetail', () => ({
  MediaSlotDetail: ({ slotName, onDone }: { slotName: string; onDone: () => void }) => (
    <div data-testid="media-slot-detail">
      Detail for {slotName}
      <button onClick={onDone}>Done</button>
    </div>
  ),
  formatSlotName: (name: string) => name,
}));

vi.mock('@/app/develop/components/media/MediaSlotsGrid', () => ({
  MediaSlotsGrid: ({ onSelectSlot }: { onSelectSlot: (slot: string) => void }) => (
    <div data-testid="media-slots-grid">
      <button onClick={() => onSelectSlot('slot-1')}>Select slot-1</button>
    </div>
  ),
}));

describe('MediaPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMediaSlotDialogStore.panelSlotName = null;
  });

  it('renders grid by default', () => {
    renderWithProviders(<MediaPanel isActive={true} />);
    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
  });

  it('navigates to detail when slot is selected', async () => {
    const { user } = renderWithProviders(<MediaPanel isActive={true} />);
    
    await user.click(screen.getByText('Select slot-1'));
    
    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();
    expect(screen.getByText('Detail for slot-1')).toBeInTheDocument();
  });

  it('navigates back to grid when back button is clicked', async () => {
    const { user } = renderWithProviders(<MediaPanel isActive={true} />);
    
    await user.click(screen.getByText('Select slot-1'));
    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();
    
    await user.click(screen.getByText('slot-1')); // The back button text
    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
  });

  it('navigates to detail when panelSlotName is set externally', async () => {
    mockMediaSlotDialogStore.panelSlotName = 'external-slot';
    
    renderWithProviders(<MediaPanel isActive={true} />);
    
    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();
    expect(screen.getByText('Detail for external-slot')).toBeInTheDocument();
    expect(mockMediaSlotDialogStore.clearPanelSlot).toHaveBeenCalled();
  });

  it('navigates to grid when panelSlotName is __GRID__', async () => {
    // First navigate to a slot
    const { user, rerender } = renderWithProviders(<MediaPanel isActive={true} />);
    await user.click(screen.getByText('Select slot-1'));
    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();

    // Then simulate external navigation to __GRID__
    mockMediaSlotDialogStore.panelSlotName = '__GRID__';
    rerender(<MediaPanel isActive={true} />);
    
    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
    expect(mockMediaSlotDialogStore.clearPanelSlot).toHaveBeenCalled();
  });
});
