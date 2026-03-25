import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { SsoExpirationCode } from '@/lib/features';
import { useAuthUIStore } from './useAuthUIStore';

describe('useAuthUIStore', () => {
  beforeEach(() => {
    // Reset the store to initial state before each test
    act(() => {
      useAuthUIStore.setState({
        isSsoLoginOpen: false,
        isSsoLoading: true,
        ssoCloseReason: null,
        needsReauth: false,
        reauthReason: null,
        requiresRefresh: false,
        authReason: null,
        needsReauthSeq: 0,
        redirectUrl: null,
      });
    });
  });

  describe('SSO Modal', () => {
    it('should open SSO login modal', () => {
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
      });

      const state = useAuthUIStore.getState();
      expect(state.isSsoLoginOpen).toBe(true);
      expect(state.isSsoLoading).toBe(true);
    });

    it('should close SSO login modal', () => {
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
        useAuthUIStore.getState().closeSsoLogin();
      });

      const state = useAuthUIStore.getState();
      expect(state.isSsoLoginOpen).toBe(false);
      expect(state.ssoCloseReason).toBe('dismiss');
    });

    it('should set ssoCloseReason to success when closed with success', () => {
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
        useAuthUIStore.getState().closeSsoLogin('success');
      });

      expect(useAuthUIStore.getState().ssoCloseReason).toBe('success');
    });

    it('should clear ssoCloseReason', () => {
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
        useAuthUIStore.getState().closeSsoLogin();
        useAuthUIStore.getState().clearSsoCloseReason();
      });

      expect(useAuthUIStore.getState().ssoCloseReason).toBeNull();
    });

    it('should guard against multiple opens', () => {
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
      });

      // Set loading to false to simulate loaded state
      act(() => {
        useAuthUIStore.getState().setSsoLoaded();
      });

      expect(useAuthUIStore.getState().isSsoLoading).toBe(false);

      // Try to open again - should not reset isSsoLoading
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
      });

      // isSsoLoading should still be false because guard prevented re-open
      expect(useAuthUIStore.getState().isSsoLoading).toBe(false);
    });

    it('should mark SSO as loaded', () => {
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
        useAuthUIStore.getState().setSsoLoaded();
      });

      expect(useAuthUIStore.getState().isSsoLoading).toBe(false);
    });
  });

  describe('Auth Boundary State', () => {
    it('should set needsReauth with reason', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });

      const state = useAuthUIStore.getState();
      expect(state.needsReauth).toBe(true);
      expect(state.reauthReason).toBe('session_expired');
    });

    it('should set needsReauth with requiresRefresh flag', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_stale', true);
      });

      const state = useAuthUIStore.getState();
      expect(state.needsReauth).toBe(true);
      expect(state.reauthReason).toBe('session_stale');
      expect(state.requiresRefresh).toBe(true);
    });

    it('should clear needsReauth and all related state', () => {
      // First set some state
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired', true);
      });

      // Then clear it
      act(() => {
        useAuthUIStore.getState().clearNeedsReauth();
      });

      const state = useAuthUIStore.getState();
      expect(state.needsReauth).toBe(false);
      expect(state.reauthReason).toBeNull();
      expect(state.requiresRefresh).toBe(false);
    });

    it('should handle not_authenticated reason', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      expect(useAuthUIStore.getState().reauthReason).toBe('not_authenticated');
    });

    it('should increment needsReauthSeq on each setNeedsReauth', () => {
      expect(useAuthUIStore.getState().needsReauthSeq).toBe(0);

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });
      expect(useAuthUIStore.getState().needsReauthSeq).toBe(1);

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_stale');
      });
      expect(useAuthUIStore.getState().needsReauthSeq).toBe(2);

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });
      expect(useAuthUIStore.getState().needsReauthSeq).toBe(3);
    });

    it('should not clear when expectedSeq does not match', () => {
      // Set needsReauth (increments seq to 1)
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });
      expect(useAuthUIStore.getState().needsReauthSeq).toBe(1);
      expect(useAuthUIStore.getState().needsReauth).toBe(true);

      // Try to clear with old seq (0) - should be no-op
      act(() => {
        useAuthUIStore.getState().clearNeedsReauth(0);
      });

      const state = useAuthUIStore.getState();
      expect(state.needsReauth).toBe(true);
      expect(state.reauthReason).toBe('session_expired');
      expect(state.needsReauthSeq).toBe(1);
    });

    it('should clear when expectedSeq matches', () => {
      // Set needsReauth (increments seq to 1)
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });
      expect(useAuthUIStore.getState().needsReauthSeq).toBe(1);

      // Clear with correct seq (1) - should succeed
      act(() => {
        useAuthUIStore.getState().clearNeedsReauth(1);
      });

      const state = useAuthUIStore.getState();
      expect(state.needsReauth).toBe(false);
      expect(state.reauthReason).toBeNull();
      // Note: seq is not reset on clear, it continues to increment
      expect(state.needsReauthSeq).toBe(1);
    });

    it('should store authReason when provided to setNeedsReauth', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired', false, SsoExpirationCode.HBI);
      });

      const state = useAuthUIStore.getState();
      expect(state.authReason).toBe(SsoExpirationCode.HBI);
      expect(state.needsReauth).toBe(true);
    });

    it('should set authReason to null when omitted from setNeedsReauth', () => {
      // First set with authReason
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired', false, SsoExpirationCode.HBI);
      });
      expect(useAuthUIStore.getState().authReason).toBe(SsoExpirationCode.HBI);

      // Then set without authReason - should reset to null
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });
      expect(useAuthUIStore.getState().authReason).toBeNull();
    });

    it('should clear authReason when clearNeedsReauth is called', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired', false, SsoExpirationCode.HBI);
      });
      expect(useAuthUIStore.getState().authReason).toBe(SsoExpirationCode.HBI);

      act(() => {
        useAuthUIStore.getState().clearNeedsReauth();
      });
      expect(useAuthUIStore.getState().authReason).toBeNull();
    });

    it('should clear when expectedSeq is undefined (unconditional clear)', () => {
      // Set needsReauth
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });
      expect(useAuthUIStore.getState().needsReauth).toBe(true);

      // Clear without expectedSeq - should always succeed
      act(() => {
        useAuthUIStore.getState().clearNeedsReauth();
      });

      expect(useAuthUIStore.getState().needsReauth).toBe(false);
    });
  });
});
