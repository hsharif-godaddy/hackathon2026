/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import { postMessageToIframe } from '@/utils/postMessage';
import MediaPanel from './MediaPanel';

const mockAppId = 'app-123';

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => mockAppId,
}));

const mockSetActiveChatTab = vi.fn();
const mockHandleMobileModeChange = vi.fn();
let mockActiveChatTab: ChatTab = ChatTab.MEDIAS;
let mockMobileMode: MobileMode = MobileMode.TOOLS;
let mockViewMode: ViewMode = ViewMode.EDIT;

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    activeChatTab: mockActiveChatTab,
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

vi.mock('@/stores/useDevelopPageStore', () => {
  const mockGetState = vi.fn(function () { return {
    activeChatTab: mockActiveChatTab,
    chatPaneWidth: 400,
    setChatPaneWidth: vi.fn(),
    handleMobileModeChange: mockHandleMobileModeChange,
  }; });
  const mockUseDevelopPageStore = vi.fn(function (selector: (s: Record<string, unknown>) => unknown) { return selector({
      activeChatTab: mockActiveChatTab,
      chatPaneWidth: 400,
      mobileMode: mockMobileMode,
      viewMode: mockViewMode,
    }); }
  ) as unknown as { getState: typeof mockGetState };
  (mockUseDevelopPageStore as unknown as { getState: typeof mockGetState }).getState = mockGetState;
  return {
    DEFAULT_CHAT_PANE_WIDTH: 400,
    useDevelopPageStore: mockUseDevelopPageStore,
  };
});

const mockMediaSlotDialogStore = {
  panelSlotName: null as string | null,
  panelSlotOccurrenceIndex: null as number | null,
  panelSlotForkContext: null,
  panelSkipPreviewScroll: false,
  panelCarouselSlotEdit: false,
  clearPanelSlot: vi.fn(),
  clearPanelSlotForkContext: vi.fn(),
  mediaReturnTab: null as ChatTab | null,
  mediaReturnMobileMode: null as MobileMode | null,
  clearMediaReturnState: vi.fn(),
  openEditorForSlot: null as string | null,
  clearEditorSlot: vi.fn(),
  setCurrentSlotName: vi.fn(),
};

vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: Object.assign(
    (selector: unknown) => (selector as (state: unknown) => unknown)(mockMediaSlotDialogStore),
    { getState: () => mockMediaSlotDialogStore },
  ),
}));

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}));

vi.mock('@/app/[market]/develop/components/media/MediaSlotDetail', () => ({
  MediaSlotDetail: ({
    slotName,
    onDone,
    onEdit,
  }: {
    slotName: string;
    onDone: () => void;
    onEdit?: (url: string) => void;
  }) => (
    <div data-testid="media-slot-detail">
      Detail for {slotName}
      <button onClick={onDone}>Done</button>
      {onEdit && <button onClick={() => onEdit('http://example.com/img.jpg')}>Edit</button>}
    </div>
  ),
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
    mockMediaSlotDialogStore.openEditorForSlot = null;
    mockMediaSlotDialogStore.panelCarouselSlotEdit = false;
    mockActiveChatTab = ChatTab.MEDIAS;
    mockMobileMode = MobileMode.TOOLS;
    mockViewMode = ViewMode.EDIT;
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

  it('grid view has no back button when no return tab is set', () => {
    renderWithProviders(<MediaPanel />);
    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
    expect(screen.queryByText('builder_common_back')).toBeNull();
  });

  it('grid view shows back button when entered via See-all carrot, restores tab + mode on click', async () => {
    mockMediaSlotDialogStore.panelSlotName = '__GRID__';
    mockMediaSlotDialogStore.mediaReturnTab = ChatTab.CHAT;
    mockMediaSlotDialogStore.mediaReturnMobileMode = MobileMode.TOOLS;

    const { user } = renderWithProviders(<MediaPanel />);

    await user.click(screen.getByText('builder_common_back'));

    expect(mockSetActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT);
    expect(mockHandleMobileModeChange).toHaveBeenCalledWith(MobileMode.TOOLS);
    expect(mockMediaSlotDialogStore.clearMediaReturnState).toHaveBeenCalled();
  });

  it('clears stale mediaReturnTab when the user leaves the Media tab by another route', () => {
    mockActiveChatTab = ChatTab.CHAT;
    mockMediaSlotDialogStore.mediaReturnTab = ChatTab.CHAT;
    mockMediaSlotDialogStore.mediaReturnMobileMode = MobileMode.TOOLS;

    renderWithProviders(<MediaPanel />);

    expect(mockMediaSlotDialogStore.clearMediaReturnState).toHaveBeenCalled();
  });

  it('ends carousel slot edit only when leaving detail, not when switching slots', async () => {
    document.body.innerHTML = '<iframe id="preview-iframe"></iframe>';
    mockMediaSlotDialogStore.panelSlotName = 'pages/home/hero-1';

    const { rerender, user } = renderWithProviders(<MediaPanel />);
    expect(vi.mocked(postMessageToIframe)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'CAROUSEL_SLOT_EDIT', active: false }),
    );

    mockMediaSlotDialogStore.panelSlotName = 'pages/home/hero-2';
    rerender(<MediaPanel />);
    expect(vi.mocked(postMessageToIframe)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'CAROUSEL_SLOT_EDIT', active: false }),
    );

    await user.click(screen.getByText('builder_common_back'));
    expect(vi.mocked(postMessageToIframe)).toHaveBeenCalledWith(
      expect.anything(),
      { type: 'CAROUSEL_SLOT_EDIT', active: false },
    );
  });

  it('exits carousel replace detail when switching to Preview on mobile', async () => {
    document.body.innerHTML = '<iframe id="preview-iframe"></iframe>';
    mockMediaSlotDialogStore.panelSlotName = 'pages/home/hero-1';
    mockMediaSlotDialogStore.panelCarouselSlotEdit = true;
    mockMediaSlotDialogStore.mediaReturnTab = ChatTab.CHAT;
    mockMediaSlotDialogStore.mediaReturnMobileMode = MobileMode.PREVIEW;
    mockMobileMode = MobileMode.TOOLS;

    const { rerender } = renderWithProviders(<MediaPanel />);
    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();

    mockMobileMode = MobileMode.PREVIEW;
    rerender(<MediaPanel />);

    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
    expect(mockSetActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT);
    expect(mockHandleMobileModeChange).toHaveBeenCalledWith(MobileMode.PREVIEW);
    expect(vi.mocked(postMessageToIframe)).toHaveBeenCalledWith(
      expect.anything(),
      { type: 'CAROUSEL_SLOT_EDIT', active: false },
    );
  });

  it('exits carousel replace detail when switching to Preview on desktop', async () => {
    document.body.innerHTML = '<iframe id="preview-iframe"></iframe>';
    mockMediaSlotDialogStore.panelSlotName = 'pages/home/hero-1';
    mockMediaSlotDialogStore.panelCarouselSlotEdit = true;
    mockMediaSlotDialogStore.mediaReturnTab = ChatTab.CHAT;
    mockViewMode = ViewMode.EDIT;

    const { rerender } = renderWithProviders(<MediaPanel />);
    expect(screen.getByTestId('media-slot-detail')).toBeInTheDocument();

    mockViewMode = ViewMode.PREVIEW;
    rerender(<MediaPanel />);

    expect(screen.getByTestId('media-slots-grid')).toBeInTheDocument();
    expect(mockSetActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT);
    expect(vi.mocked(postMessageToIframe)).toHaveBeenCalledWith(
      expect.anything(),
      { type: 'CAROUSEL_SLOT_EDIT', active: false },
    );
  });
});
