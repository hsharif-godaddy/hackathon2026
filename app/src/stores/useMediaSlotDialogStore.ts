import { create } from 'zustand';

import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

interface MediaSlotDialogState {
  /**
   * Panel navigation: slot to navigate to in the Media tab panel.
   * Set externally (e.g., from preview "Swap Image") to push to that slot's detail view.
   * Consumed and cleared by MediaPanel.
   */
  panelSlotName: string | null;

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
   * Navigate the media panel to a specific slot (or `__GRID__` for the
   * grid view). Snapshots the active chat tab + mobileMode synchronously
   * — call BEFORE `setActiveChatTab(MEDIAS)` so the source tab is
   * captured, not the destination.
   */
  navigateToSlot: (slotName: string, options?: { openEditor?: boolean }) => void;
  /** Clear the panel navigation slot (consumed by MediaPanel) */
  clearPanelSlot: () => void;
  clearMediaReturnState: () => void;
  /** Clear the editor slot (consumed by MediaPanel) */
  clearEditorSlot: () => void;
  /** Update scroll-to-media match count from the preview iframe response */
  setMediaScrollResult: (totalMatches: number, currentIndex: number) => void;
}

export const useMediaSlotDialogStore = create<MediaSlotDialogState>((set) => ({
  panelSlotName: null,
  mediaReturnTab: null,
  mediaReturnMobileMode: null,
  openEditorForSlot: null,
  mediaScrollTotalMatches: 0,
  mediaScrollCurrentIndex: 0,

  navigateToSlot: (slotName: string, options?: { openEditor?: boolean }) => {
    // Snapshot source tab for back-breadcrumb. `openEditor` is real-slot only.
    const develop = useDevelopPageStore.getState();
    set({
      panelSlotName: slotName,
      mediaReturnTab: develop.activeChatTab,
      mediaReturnMobileMode: develop.mobileMode,
      openEditorForSlot:
        slotName !== '__GRID__' && options?.openEditor ? slotName : null,
      mediaScrollTotalMatches: 0,
      mediaScrollCurrentIndex: 0,
    });
  },

  clearPanelSlot: () => {
    set({ panelSlotName: null, mediaScrollTotalMatches: 0, mediaScrollCurrentIndex: 0 });
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
