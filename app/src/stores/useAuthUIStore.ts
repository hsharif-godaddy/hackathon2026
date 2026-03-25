import { create } from 'zustand';

/**
 * Reason why authentication is required
 */
export type AuthRequiredReason =
  | 'not_authenticated'  // User is not logged in
  | 'session_stale'      // Token is too old and needs refresh
  | 'session_expired';   // Token has expired

interface AuthUIStore {
  // === SSO Modal State ===
  /** Whether the SSO login modal is open */
  isSsoLoginOpen: boolean;
  /** Whether the SSO deck iframe is loading */
  isSsoLoading: boolean;
  /** Last modal close: success (auth completed) vs dismiss (user closed without completing) */
  ssoCloseReason: 'success' | 'dismiss' | null;

  // === Auth Boundary State ===
  /** Whether re-authentication is needed (set automatically by appFetch on 401) */
  needsReauth: boolean;
  /** Reason why auth is required */
  reauthReason: AuthRequiredReason | null;
  /** Whether the session requires refresh (token is stale but valid) */
  requiresRefresh: boolean;
  /** SSO expiration code from gd-auth indicating why the token was rejected (see SsoExpirationCode) */
  authReason: number | null;
  /** Sequence incremented every time needsReauth is set */
  needsReauthSeq: number;
  /**
   * URL to redirect to after successful authentication
   * Captured when SSO modal opens to return user to their original page
   */
  redirectUrl: string | null;

  // === SSO Modal Actions ===
  /** Open the SSO login modal */
  openSsoLogin: () => void;
  /** Close the SSO login modal (default: user dismissed) */
  closeSsoLogin: (reason?: 'success' | 'dismiss') => void;
  clearSsoCloseReason: () => void;
  /** Mark SSO deck as loaded */
  setSsoLoaded: () => void;

  // === Auth Boundary Actions ===
  /**
   * Set auth required state (called automatically by appFetch on 401)
   * Components can subscribe to needsReauth to show "login required" UI via AuthBoundary
   */
  setNeedsReauth: (reason: AuthRequiredReason, requiresRefresh?: boolean, authReason?: number) => void;
  /** Clear the auth required state (called after successful login or user dismisses) */
  clearNeedsReauth: (expectedSeq?: number) => void;
  /** Set URL to redirect to after successful authentication */
  setRedirectUrl: (url: string | null) => void;
}

/**
 * Zustand store for auth UI state
 *
 * Manages global auth-related UI elements and auth boundary state.
 * This allows any component to:
 * - Trigger the login modal without prop drilling
 * - Subscribe to auth requirement signals from API calls
 * - Show "login required" UI instead of being auto-redirected
 *
 * appFetch automatically sets needsReauth on 401 responses, so most components
 * just need to use AuthBoundary to handle the UI:
 *
 * @example
 * ```tsx
 * // Wrap your component with AuthBoundary to show login UI on 401
 * <AuthBoundary>
 *   <MyComponent />
 * </AuthBoundary>
 *
 * // Or manually check auth state
 * const { needsReauth, reauthReason } = useAuthUIStore();
 * if (needsReauth) {
 *   return <MyCustomLoginPrompt reason={reauthReason} />;
 * }
 * ```
 */
export const useAuthUIStore = create<AuthUIStore>((set, get) => ({
  // SSO Modal State
  isSsoLoginOpen: false,
  isSsoLoading: true,
  ssoCloseReason: null,

  // Auth Boundary State
  needsReauth: false,
  reauthReason: null,
  requiresRefresh: false,
  authReason: null,
  needsReauthSeq: 0,
  redirectUrl: null,

  // SSO Modal Actions
  openSsoLogin: () => {
    // Guard against multiple opens
    if (get().isSsoLoginOpen) return;
    set({ isSsoLoginOpen: true, isSsoLoading: true, ssoCloseReason: null });
  },
  closeSsoLogin: (reason = 'dismiss') => set({ isSsoLoginOpen: false, ssoCloseReason: reason }),
  clearSsoCloseReason: () => set({ ssoCloseReason: null }),
  setSsoLoaded: () => set({ isSsoLoading: false }),

  // Auth Boundary Actions
  setNeedsReauth: (reason, requiresRefresh = false, authReason) => set((state) => ({
    needsReauth: true,
    reauthReason: reason,
    requiresRefresh,
    authReason: authReason ?? null,
    needsReauthSeq: state.needsReauthSeq + 1
  })),

  clearNeedsReauth: (expectedSeq) => set((state) => {
    if (expectedSeq !== undefined && expectedSeq !== state.needsReauthSeq) {
      return state;
    }
    return {
      needsReauth: false,
      reauthReason: null,
      requiresRefresh: false,
      authReason: null,
      redirectUrl: null  // Clear redirect URL when clearing auth state
    };
  }),

  setRedirectUrl: (url) => set({ redirectUrl: url })
}));
