import { create } from 'zustand';

interface AuthUIStore {
  // === SSO Modal State ===
  isSsoLoginOpen: boolean;
  isSsoLoading: boolean;
  ssoCloseReason: 'success' | 'dismiss' | null;
  /**
   * Auth failure reason used to route SSODeck to the right page (e.g. HBI
   * challenge vs full login). Set by authPreflight when it gets a 401 with
   * an authReason in the body. SsoLogin prefers this over authState.authReason
   * for preflight-initiated SSO opens.
   */
  ssoAuthReason: number | null;

  // === Redirect State ===
  redirectUrl: string | null;

  // === SSO Modal Actions ===
  openSsoLogin: () => void;
  closeSsoLogin: (reason?: 'success' | 'dismiss') => void;
  clearSsoCloseReason: () => void;
  setSsoLoaded: () => void;
  setSsoAuthReason: (reason: number | null) => void;

  // === Redirect Actions ===
  setRedirectUrl: (url: string | null) => void;
}

/**
 * Zustand store for SSO modal UI state.
 *
 * Controls the SSODeck modal visibility and post-auth redirect URL.
 * Auth truth lives in Gasket Auth's authState -- this store only manages UI.
 */
export const useAuthUIStore = create<AuthUIStore>((set, get) => ({
  isSsoLoginOpen: false,
  isSsoLoading: true,
  ssoCloseReason: null,
  ssoAuthReason: null,

  redirectUrl: null,

  openSsoLogin: () => {
    if (get().isSsoLoginOpen) return;
    set({ isSsoLoginOpen: true, isSsoLoading: true, ssoCloseReason: null });
  },
  closeSsoLogin: (reason = 'dismiss') => set({ isSsoLoginOpen: false, ssoCloseReason: reason, ssoAuthReason: null }),
  clearSsoCloseReason: () => set({ ssoCloseReason: null }),
  setSsoLoaded: () => set({ isSsoLoading: false }),
  setSsoAuthReason: (reason) => set({ ssoAuthReason: reason }),

  setRedirectUrl: (url) => set({ redirectUrl: url })
}));
