import { create } from 'zustand';

import type { AuthResponseMetadata } from '@/lib/gasket-config';

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

  // === Auth Boundary State ===
  /** Whether re-authentication is needed (set automatically by appFetch on 401) */
  needsReauth: boolean;
  /** Reason why auth is required */
  reauthReason: AuthRequiredReason | null;
  /** URL to redirect to for login (if user chooses to login) */
  loginUrl: string | null;
  /** Additional metadata from the 401 response */
  authMetadata: AuthResponseMetadata | null;
  /**
   * URL to redirect to after successful authentication
   * Captured when SSO modal opens to return user to their original page
   */
  redirectUrl: string | null;

  // === SSO Modal Actions ===
  /** Open the SSO login modal */
  openSsoLogin: () => void;
  /** Close the SSO login modal */
  closeSsoLogin: () => void;
  /** Mark SSO deck as loaded */
  setSsoLoaded: () => void;

  // === Auth Boundary Actions ===
  /**
   * Set auth required state (called automatically by appFetch on 401)
   * Components can subscribe to needsReauth to show "login required" UI via AuthBoundary
   */
  setNeedsReauth: (reason: AuthRequiredReason, loginUrl?: string, metadata?: AuthResponseMetadata) => void;
  /** Clear the auth required state (called after successful login or user dismisses) */
  clearNeedsReauth: () => void;
  /** Convenience: redirect to login URL if set */
  redirectToLogin: () => void;
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

  // Auth Boundary State
  needsReauth: false,
  reauthReason: null,
  loginUrl: null,
  authMetadata: null,
  redirectUrl: null,

  // SSO Modal Actions
  openSsoLogin: () => {
    // Guard against multiple opens
    if (get().isSsoLoginOpen) return;
    set({ isSsoLoginOpen: true, isSsoLoading: true });
  },
  closeSsoLogin: () => set({ isSsoLoginOpen: false }),
  setSsoLoaded: () => set({ isSsoLoading: false }),

  // Auth Boundary Actions
  setNeedsReauth: (reason, loginUrl, metadata) => set({
    needsReauth: true,
    reauthReason: reason,
    loginUrl: loginUrl ?? null,
    authMetadata: metadata ?? null
  }),

  clearNeedsReauth: () => set({
    needsReauth: false,
    reauthReason: null,
    loginUrl: null,
    authMetadata: null,
    redirectUrl: null  // Clear redirect URL when clearing auth state
  }),

  redirectToLogin: () => {
    const { loginUrl } = get();
    if (loginUrl && typeof window !== 'undefined') {
      window.location.href = loginUrl;
    }
  },

  setRedirectUrl: (url) => set({ redirectUrl: url })
}));

