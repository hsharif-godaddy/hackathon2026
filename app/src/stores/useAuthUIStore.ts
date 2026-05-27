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
  /**
   * True when the SSO modal was opened by an in-flight authPreflight (a fetch
   * mid-mutation that needs a step-up). On success, SsoLogin must NOT navigate
   * — the awaiting fetch resumes after the verify probe and completes the
   * mutation in place. Cleared by closeSsoLogin so a subsequent explicit "log
   * back in" UI flow keeps its expected reload behavior.
   */
  inFlightReauth: boolean;

  // === Redirect State ===
  redirectUrl: string | null;

  // === SSO Modal Actions ===
  openSsoLogin: () => void;
  closeSsoLogin: (reason?: 'success' | 'dismiss') => void;
  clearSsoCloseReason: () => void;
  setSsoLoaded: () => void;
  setSsoAuthReason: (reason: number | null) => void;
  setInFlightReauth: (value: boolean) => void;

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
  inFlightReauth: false,

  redirectUrl: null,

  openSsoLogin: () => {
    if (get().isSsoLoginOpen) return;
    set({ isSsoLoginOpen: true, isSsoLoading: true, ssoCloseReason: null });
  },
  // Reset all transient open-state in one place so no close path can leak
  // stale ssoAuthReason / redirectUrl / inFlightReauth into a later open.
  closeSsoLogin: (reason = 'dismiss') => set({ isSsoLoginOpen: false, ssoCloseReason: reason, ssoAuthReason: null, inFlightReauth: false, redirectUrl: null }),
  clearSsoCloseReason: () => set({ ssoCloseReason: null }),
  setSsoLoaded: () => set({ isSsoLoading: false }),
  setSsoAuthReason: (reason) => set({ ssoAuthReason: reason }),
  setInFlightReauth: (value) => set({ inFlightReauth: value }),

  setRedirectUrl: (url) => set({ redirectUrl: url })
}));
