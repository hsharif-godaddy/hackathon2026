import { create } from 'zustand';

interface AuthUIStore {
  /** Whether the SSO login modal is open */
  isSsoLoginOpen: boolean;
  /** Whether the SSO deck iframe is loading */
  isSsoLoading: boolean;

  /** Open the SSO login modal */
  openSsoLogin: () => void;
  /** Close the SSO login modal */
  closeSsoLogin: () => void;
  /** Mark SSO deck as loaded */
  setSsoLoaded: () => void;
}

/**
 * Zustand store for auth UI state
 *
 * Manages global auth-related UI elements like the SSO login modal.
 * This allows any component to trigger the login modal without prop drilling.
 */
export const useAuthUIStore = create<AuthUIStore>((set) => ({
  isSsoLoginOpen: false,
  isSsoLoading: true,

  openSsoLogin: () => set({ isSsoLoginOpen: true, isSsoLoading: true }),
  closeSsoLogin: () => set({ isSsoLoginOpen: false }),
  setSsoLoaded: () => set({ isSsoLoading: false }),
}));

