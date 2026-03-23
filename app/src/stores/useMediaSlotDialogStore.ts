import { create } from 'zustand';

interface MediaSlotDialogState {
  /**
   * Panel navigation: slot to navigate to in the Media tab panel.
   * Set externally (e.g., from preview "Swap Image") to push to that slot's detail view.
   * Consumed and cleared by MediaPanel.
   */
  panelSlotName: string | null;

  /** Navigate the media panel to a specific slot (does not open the sheet dialog) */
  navigateToSlot: (slotName: string) => void;
  /** Clear the panel navigation slot (consumed by MediaPanel) */
  clearPanelSlot: () => void;
}

export const useMediaSlotDialogStore = create<MediaSlotDialogState>((set) => ({
  panelSlotName: null,

  navigateToSlot: (slotName: string) => {
    set({ panelSlotName: slotName });
  },

  clearPanelSlot: () => {
    set({ panelSlotName: null });
  },
}));
