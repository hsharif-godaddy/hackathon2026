import { beforeEach, describe, expect, it } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react';

import { useAuthUIStore } from './useAuthUIStore';

describe('useAuthUIStore', () => {
  beforeEach(() => {
    act(() => {
      useAuthUIStore.setState({
        isSsoLoginOpen: false,
        isSsoLoading: true,
        ssoCloseReason: null,
        ssoAuthReason: null,
        inFlightReauth: false,
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

  describe('inFlightReauth', () => {
    it('defaults to false', () => {
      expect(useAuthUIStore.getState().inFlightReauth).toBe(false);
    });

    it('setInFlightReauth toggles the flag', () => {
      act(() => {
        useAuthUIStore.getState().setInFlightReauth(true);
      });
      expect(useAuthUIStore.getState().inFlightReauth).toBe(true);

      act(() => {
        useAuthUIStore.getState().setInFlightReauth(false);
      });
      expect(useAuthUIStore.getState().inFlightReauth).toBe(false);
    });

    it('closeSsoLogin clears inFlightReauth on success', () => {
      act(() => {
        useAuthUIStore.getState().setInFlightReauth(true);
        useAuthUIStore.getState().openSsoLogin();
        useAuthUIStore.getState().closeSsoLogin('success');
      });

      expect(useAuthUIStore.getState().inFlightReauth).toBe(false);
    });

    it('closeSsoLogin clears inFlightReauth on dismiss', () => {
      act(() => {
        useAuthUIStore.getState().setInFlightReauth(true);
        useAuthUIStore.getState().openSsoLogin();
        useAuthUIStore.getState().closeSsoLogin('dismiss');
      });

      expect(useAuthUIStore.getState().inFlightReauth).toBe(false);
    });
  });

  describe('redirectUrl reset on close', () => {
    it('closeSsoLogin clears redirectUrl on success', () => {
      act(() => {
        useAuthUIStore.getState().setRedirectUrl('https://airo-builder.test/develop/abc');
        useAuthUIStore.getState().openSsoLogin();
        useAuthUIStore.getState().closeSsoLogin('success');
      });

      expect(useAuthUIStore.getState().redirectUrl).toBeNull();
    });

    it('closeSsoLogin clears redirectUrl on dismiss', () => {
      act(() => {
        useAuthUIStore.getState().setRedirectUrl('https://airo-builder.test/develop/abc');
        useAuthUIStore.getState().openSsoLogin();
        useAuthUIStore.getState().closeSsoLogin('dismiss');
      });

      expect(useAuthUIStore.getState().redirectUrl).toBeNull();
    });
  });
});
