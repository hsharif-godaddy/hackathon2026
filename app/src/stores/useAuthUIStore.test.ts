import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { useAuthUIStore } from './useAuthUIStore';

describe('useAuthUIStore', () => {
  beforeEach(() => {
    // Reset the store to initial state before each test
    act(() => {
      useAuthUIStore.setState({
        isSsoLoginOpen: false,
        isSsoLoading: true,
        needsReauth: false,
        reauthReason: null,
        loginUrl: null,
        authMetadata: null,
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

      expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
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

    it('should set needsReauth with loginUrl and metadata', () => {
      const metadata = { requiresAuth: true, requiresRefresh: false };

      act(() => {
        useAuthUIStore.getState().setNeedsReauth(
          'session_stale',
          'https://sso.example.com/login',
          metadata
        );
      });

      const state = useAuthUIStore.getState();
      expect(state.needsReauth).toBe(true);
      expect(state.reauthReason).toBe('session_stale');
      expect(state.loginUrl).toBe('https://sso.example.com/login');
      expect(state.authMetadata).toEqual(metadata);
    });

    it('should clear needsReauth and all related state', () => {
      // First set some state
      act(() => {
        useAuthUIStore.getState().setNeedsReauth(
          'session_expired',
          'https://sso.example.com',
          { requiresAuth: true }
        );
      });

      // Then clear it
      act(() => {
        useAuthUIStore.getState().clearNeedsReauth();
      });

      const state = useAuthUIStore.getState();
      expect(state.needsReauth).toBe(false);
      expect(state.reauthReason).toBeNull();
      expect(state.loginUrl).toBeNull();
      expect(state.authMetadata).toBeNull();
    });

    it('should handle not_authenticated reason', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      expect(useAuthUIStore.getState().reauthReason).toBe('not_authenticated');
    });
  });
});
