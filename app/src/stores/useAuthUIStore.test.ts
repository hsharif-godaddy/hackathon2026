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
});
