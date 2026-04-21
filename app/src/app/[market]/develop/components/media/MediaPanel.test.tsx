/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { ChatTab, MobileMode, SettingsSection } from '@/app/[market]/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import MediaPanel from './MediaPanel';

const mockAppId = 'app-123';

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => mockAppId,
}));

const mockSetActiveChatTab = vi.fn();
const mockHandleMobileModeChange = vi.fn();

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    activeChatTab: ChatTab.MEDIAS,
    setActiveChatTab: mockSetActiveChatTab,
    activeSettingsSection: SettingsSection.DOMAIN,
    setActiveSettingsSection: vi.fn(),
  }),
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

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: () => ({
      handleMobileModeChange: mockHandleMobileModeChange,
    }),
  },
}));

const mockMediaSlotDialogStore = {
  panelSlotName: null as string | null,
  clearPanelSlot: vi.fn(),
  mediaReturnTab: null as ChatTab | null,
  mediaReturnMobileMode: null as MobileMode | null,
  clearMediaReturnState: vi.fn(),
};

vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: (selector: unknown) => (selector as (state: unknown) => unknown)(mockMediaSlotDialogStore),
}));

vi.mock('@/app/[market]/develop/components/media/MediaSlotDetail', () => ({
  MediaSlotDetail: ({ slotName, onDone }: { slotName: string; onDone: () => void }) => (
    <div data-testid="media-slot-detail">
      Detail for {slotName}
      <button onClick={onDone}>Done</button>
    </div>
  ),
  formatSlotName: (name: string) => name,
}));

vi.mock('@/app/[market]/develop/components/media/MediaSlotsGrid', () => ({
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
    mockMediaSlotDialogStore.mediaReturnTab = null;
    mockMediaSlotDialogStore.mediaReturnMobileMode = null;
  });

  it('renders grid by default', () => {
    renderWithProviders(<MediaPanel />);
    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
  });

  it('navigates to detail when slot is selected', async () => {
    const { user } = renderWithProviders(<MediaPanel />);

    await user.click(screen.getByText('Select slot-1'));

    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();
    expect(screen.getByText('Detail for slot-1')).toBeInTheDocument();
  });

  it('navigates back to grid when back button is clicked', async () => {
    const { user } = renderWithProviders(<MediaPanel />);

    await user.click(screen.getByText('Select slot-1'));
    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();

    await user.click(screen.getByText('builder_common_back'));
    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
    expect(mockSetActiveChatTab).not.toHaveBeenCalled();
    expect(mockHandleMobileModeChange).not.toHaveBeenCalled();
    expect(mockMediaSlotDialogStore.clearMediaReturnState).toHaveBeenCalled();
  });

  it('navigates to detail when panelSlotName is set externally', async () => {
    mockMediaSlotDialogStore.panelSlotName = 'external-slot';

    renderWithProviders(<MediaPanel />);

    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();
    expect(screen.getByText('Detail for external-slot')).toBeInTheDocument();
    expect(mockMediaSlotDialogStore.clearPanelSlot).toHaveBeenCalled();
  });

  it('restores previous tab when back from externally opened detail', async () => {
    mockMediaSlotDialogStore.panelSlotName = 'external-slot';
    mockMediaSlotDialogStore.mediaReturnTab = ChatTab.PREVIEW;
    mockMediaSlotDialogStore.mediaReturnMobileMode = MobileMode.PREVIEW;

    const { user } = renderWithProviders(<MediaPanel />);

    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();

    await user.click(screen.getByText('builder_common_back'));

    expect(mockSetActiveChatTab).toHaveBeenCalledWith(ChatTab.PREVIEW);
    expect(mockHandleMobileModeChange).toHaveBeenCalledWith(MobileMode.PREVIEW);
    expect(mockMediaSlotDialogStore.clearMediaReturnState).toHaveBeenCalled();
    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
  });

  it('navigates to grid when panelSlotName is __GRID__', async () => {
    // First navigate to a slot
    const { user, rerender } = renderWithProviders(<MediaPanel />);
    await user.click(screen.getByText('Select slot-1'));
    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();

    // Then simulate external navigation to __GRID__
    mockMediaSlotDialogStore.panelSlotName = '__GRID__';
    rerender(<MediaPanel />);

    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
    expect(mockMediaSlotDialogStore.clearPanelSlot).toHaveBeenCalled();
  });
});
