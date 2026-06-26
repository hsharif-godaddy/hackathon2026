import { create } from 'zustand';

import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import type { BusMediaSlotForkContext } from '@/utils/eventBus';

/** Sentinel value passed to navigateToSlot to open the media grid view (no specific slot selected) */
export const MEDIA_GRID_VIEW = '__GRID__';

interface MediaSlotDialogState {
  /**
   * Panel navigation: slot to navigate to in the Media tab panel.
   * Set externally (e.g., from preview "Swap Image") to push to that slot's detail view.
   * Consumed and cleared by MediaPanel.
   */
  panelSlotName: string | null;

  /**
   * 0-based DOM instance index when opening from preview Replace.
   */
  panelSlotOccurrenceIndex: number | null;

  /**
   * Element context captured when opening a slot from preview Replace.
   * Used to fork shared slots so only the clicked item updates.
   */
  panelSlotForkContext: BusMediaSlotForkContext | null;

  /**
   * Tab active when navigateToSlot was called; used by MediaPanel back to
   * restore the previous tab. Cleared after consume.
   */
  mediaReturnTab: ChatTab | null;

  /**
   * mobileMode when navigateToSlot was called; used on mobile to restore Preview vs Tools.
   */
  mediaReturnMobileMode: MobileMode | null;

  /**
   * Slot name for which the image editor should open directly.
   * Set when navigating to a slot with openEditor=true.
   * Cleared independently by MediaPanel to avoid race conditions.
   */
  openEditorForSlot: string | null;

  /**
   * Scroll-to-media state: how many DOM elements match the active slot,
   * and which one is currently scrolled to.
   */
  mediaScrollTotalMatches: number;
  mediaScrollCurrentIndex: number;

  /**
   * Slot currently displayed by MediaPanel, or null when on the grid.
   * MediaPanel keeps this in sync; consumers (e.g. CommanderTabBackButton)
   * read it to suppress redundant back UI when MediaPanel renders its own.
   */
  currentSlotName: string | null;
  setCurrentSlotName: (slotName: string | null) => void;

  /**
   * Navigate the media panel to a specific slot (or `__GRID__` for the
   * grid view). Snapshots the active chat tab + mobileMode synchronously
   * — call BEFORE `setActiveChatTab(MEDIAS)` so the source tab is
   * captured, not the destination.
   */
  navigateToSlot: (
    slotName: string,
    options?: {
      openEditor?: boolean;
      forkContext?: BusMediaSlotForkContext | null;
      occurrenceIndex?: number | null;
    },
  ) => void;
  /** Clear the panel navigation slot (consumed by MediaPanel) */
  clearPanelSlot: () => void;
  /** Clear preview element context after a fork swap or leaving external detail */
  clearPanelSlotForkContext: () => void;
  clearMediaReturnState: () => void;
  /** Clear the editor slot (consumed by MediaPanel) */
  clearEditorSlot: () => void;
  /** Update scroll-to-media match count from the preview iframe response */
  setMediaScrollResult: (totalMatches: number, currentIndex: number) => void;
}

export const useMediaSlotDialogStore = create<MediaSlotDialogState>((set) => ({
  panelSlotName: null,
  panelSlotOccurrenceIndex: null,
  panelSlotForkContext: null,
  mediaReturnTab: null,
  mediaReturnMobileMode: null,
  openEditorForSlot: null,
  mediaScrollTotalMatches: 0,
  mediaScrollCurrentIndex: 0,
  currentSlotName: null,

  setCurrentSlotName: (slotName: string | null) => {
    set({ currentSlotName: slotName });
  },

  navigateToSlot: (
    slotName: string,
    options?: {
      openEditor?: boolean;
      forkContext?: BusMediaSlotForkContext | null;
      occurrenceIndex?: number | null;
    },
  ) => {
    // Snapshot source tab for back-breadcrumb. `openEditor` is real-slot only.
    const develop = useDevelopPageStore.getState();
    set({
      panelSlotName: slotName,
      panelSlotOccurrenceIndex: options?.occurrenceIndex ?? null,
      panelSlotForkContext: options?.forkContext ?? null,
      mediaReturnTab: develop.activeChatTab,
      mediaReturnMobileMode: develop.mobileMode,
      openEditorForSlot:
        slotName !== MEDIA_GRID_VIEW && options?.openEditor ? slotName : null,
      mediaScrollTotalMatches: 0,
      mediaScrollCurrentIndex: 0,
    });
  },

  clearPanelSlot: () => {
    set({
      panelSlotName: null,
      mediaScrollTotalMatches: 0,
      mediaScrollCurrentIndex: 0,
    });
  },

  clearPanelSlotForkContext: () => {
    set({ panelSlotForkContext: null, panelSlotOccurrenceIndex: null });
  },

  clearMediaReturnState: () => {
    set({ mediaReturnTab: null, mediaReturnMobileMode: null });
  },

  clearEditorSlot: () => {
    set({ openEditorForSlot: null });
  },

  setMediaScrollResult: (totalMatches: number, currentIndex: number) => {
    set({ mediaScrollTotalMatches: totalMatches, mediaScrollCurrentIndex: currentIndex });
  },
}));
