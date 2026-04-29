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
   * Tab active when navigateToSlot was called for a real slot; used by MediaPanel back
   * to restore the previous tab. Cleared for __GRID__ and after consume.
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

  /** Navigate the media panel to a specific slot (does not open the sheet dialog) */
  navigateToSlot: (slotName: string, options?: { openEditor?: boolean }) => void;
  /** Clear the panel navigation slot (consumed by MediaPanel) */
  clearPanelSlot: () => void;
  clearMediaReturnState: () => void;
  /** Clear the editor slot (consumed by MediaPanel) */
  clearEditorSlot: () => void;
}

export const useMediaSlotDialogStore = create<MediaSlotDialogState>((set) => ({
  panelSlotName: null,
  mediaReturnTab: null,
  mediaReturnMobileMode: null,
  openEditorForSlot: null,

  navigateToSlot: (slotName: string, options?: { openEditor?: boolean }) => {
    if (slotName === '__GRID__') {
      set({
        panelSlotName: slotName,
        mediaReturnTab: null,
        mediaReturnMobileMode: null,
        openEditorForSlot: null,
      });
      return;
    }
    const develop = useDevelopPageStore.getState();
    set({
      panelSlotName: slotName,
      mediaReturnTab: develop.activeChatTab,
      mediaReturnMobileMode: develop.mobileMode,
      openEditorForSlot: options?.openEditor ? slotName : null,
    });
  },

  clearPanelSlot: () => {
    set({ panelSlotName: null });
  },

  clearMediaReturnState: () => {
    set({ mediaReturnTab: null, mediaReturnMobileMode: null });
  },

  clearEditorSlot: () => {
    set({ openEditorForSlot: null });
  },
}));
