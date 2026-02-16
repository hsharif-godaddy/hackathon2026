import { create } from 'zustand';

/**
 * State for the media slot dialog
 * Used to open/close the dialog from anywhere (tool renderer or dev-tools)
 */
interface MediaSlotDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** The slot name to display (e.g., "pages/home/hero") */
  slotName: string | null;
  /** The app ID for the current context */
  appId: string | null;
  /** Open the dialog for a specific slot */
  openDialog: (appId: string, slotName: string) => void;
  /** Close the dialog */
  closeDialog: () => void;
}

/**
 * Zustand store for media slot dialog state
 *
 * This store manages the global state for the MediaSlotDialog component,
 * allowing it to be opened from:
 * - MediaGroupRenderer thumbnails in chat
 * - Dev-tools ElementEditor "Swap Media" button
 *
 * @example
 * ```tsx
 * // Open dialog from component
 * const { openDialog } = useMediaSlotDialogStore();
 * openDialog(appId, 'pages/home/hero');
 *
 * // Read state in dialog component
 * const { isOpen, slotName, appId, closeDialog } = useMediaSlotDialogStore();
 * ```
 */
export const useMediaSlotDialogStore = create<MediaSlotDialogState>((set) => ({
  isOpen: false,
  slotName: null,
  appId: null,

  openDialog: (appId: string, slotName: string) => {
    set({
      isOpen: true,
      slotName,
      appId,
    });
  },

  closeDialog: () => {
    set({
      isOpen: false,
      slotName: null,
      appId: null,
    });
  },
}));
