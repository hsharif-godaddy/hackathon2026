/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';

import { shipAnalyticsLog } from '@/lib/logging';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import AuthBoundary from './AuthBoundary';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/develop'),
}));

// Mock UXCore components
vi.mock('@ux/modal', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="ux-modal" role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </div>
  ),
}));

vi.mock('@ux/button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@ux/text', () => ({
  default: {
    p: ({ text, className }: { text: string; className?: string }) => (
      <p className={className}>{text}</p>
    ),
  },
}));

// Mock translations
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock analytics
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

// Mock useSsoSignIn so these tests don't depend on AuthProvider context.
// The hook is the single env gate (see useSsoSignIn.ts); in JWT mode it
// delegates to openSsoLogin() which is what these tests verify.
vi.mock('@/hooks/useSsoSignIn', async () => {
  const store = await vi.importActual<typeof import('@/stores/useAuthUIStore')>(
    '@/stores/useAuthUIStore'
  );
  return {
    useSsoSignIn: () => ({
      signIn: () => {
        store.useAuthUIStore.getState().openSsoLogin();
      },
    }),
  };
});

describe('AuthBoundary', () => {
  beforeEach(async () => {
    // Reset the store to initial state before each test
    act(() => {
      useAuthUIStore.setState({
        isSsoLoginOpen: false,
        isSsoLoading: true,
        ssoCloseReason: null,
        needsReauth: false,
        reauthReason: null,
        requiresRefresh: false,
      });
    });
    vi.clearAllMocks();

    // Reset pathname mock to default
    const { usePathname } = vi.mocked(await import('next/navigation'));
    usePathname.mockReturnValue('/develop');
  });

  it('should render children when needsReauth is false', () => {
    render(
      <AuthBoundary>
        <div data-testid="child-content">Protected Content</div>
      </AuthBoundary>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByText('builder_common_signin_required')).not.toBeInTheDocument();
  });

  it('should show fallback modal when SSO was dismissed without completing auth', () => {
    const { rerender } = render(
      <AuthBoundary>
        <div data-testid="child-content">Protected Content</div>
      </AuthBoundary>
    );

    // 401 triggers auto-open, then user dismisses
    act(() => {
      useAuthUIStore.getState().setNeedsReauth('not_authenticated');
    });
    act(() => {
      useAuthUIStore.getState().closeSsoLogin('dismiss');
    });

    rerender(
      <AuthBoundary>
        <div data-testid="child-content">Protected Content</div>
      </AuthBoundary>
    );

    // Children should still render (behind modal)
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    // Modal should be visible
    expect(screen.getByText('builder_common_signin_required')).toBeInTheDocument();
    expect(screen.getByText('auth_boundary_not_authenticated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builder_common_signin' })).toBeInTheDocument();
  });

  it('should auto-open SSO modal on 401 instead of showing fallback', () => {
    act(() => {
      useAuthUIStore.getState().setNeedsReauth('not_authenticated');
    });

    render(
      <AuthBoundary>
        <div data-testid="child-content">Protected Content</div>
      </AuthBoundary>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    // Fallback modal should NOT be visible - SSO Deck was auto-opened by effect
    expect(screen.queryByText('builder_common_signin_required')).not.toBeInTheDocument();
    // SSO modal should have been opened
    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
  });

  it('should show session stale message', () => {
    const { rerender } = render(
      <AuthBoundary>
        <div>Content</div>
      </AuthBoundary>
    );

    act(() => {
      useAuthUIStore.getState().setNeedsReauth('session_stale');
    });
    act(() => {
      useAuthUIStore.getState().closeSsoLogin('dismiss');
    });

    rerender(
      <AuthBoundary>
        <div>Content</div>
      </AuthBoundary>
    );

    expect(screen.getByText('auth_boundary_session_stale')).toBeInTheDocument();
  });

  it('should show session expired message', () => {
    const { rerender } = render(
      <AuthBoundary>
        <div>Content</div>
      </AuthBoundary>
    );

    act(() => {
      useAuthUIStore.getState().setNeedsReauth('session_expired');
    });
    act(() => {
      useAuthUIStore.getState().closeSsoLogin('dismiss');
    });

    rerender(
      <AuthBoundary>
        <div>Content</div>
      </AuthBoundary>
    );

    expect(screen.getByText('auth_boundary_session_expired')).toBeInTheDocument();
  });

  it('should call openSsoLogin when Sign In button is clicked', () => {
    const { rerender } = render(
      <AuthBoundary>
        <div>Content</div>
      </AuthBoundary>
    );

    act(() => {
      useAuthUIStore.getState().setNeedsReauth('not_authenticated');
    });
    act(() => {
      useAuthUIStore.getState().closeSsoLogin('dismiss');
    });

    rerender(
      <AuthBoundary>
        <div>Content</div>
      </AuthBoundary>
    );

    const signInButton = screen.getByRole('button', { name: 'builder_common_signin' });
    fireEvent.click(signInButton);

    expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
  });

  it('should hide modal when SSO modal is already open', () => {
    act(() => {
      useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      useAuthUIStore.getState().openSsoLogin();
    });

    render(
      <AuthBoundary>
        <div data-testid="child-content">Protected Content</div>
      </AuthBoundary>
    );

    // Children should render
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    // Auth boundary modal should NOT be visible (SSO modal is handling it)
    expect(screen.queryByText('builder_common_signin_required')).not.toBeInTheDocument();
  });

  describe('public route bypass', () => {
    it('should skip auth boundary on homepage (/)', async () => {
      // Mock pathname to be homepage
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/');

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div data-testid="child-content">Homepage Content</div>
        </AuthBoundary>
      );

      // Children should render without modal
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.queryByText('builder_common_signin_required')).not.toBeInTheDocument();
    });

    it('should skip auth boundary on empty pathname', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('');

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div data-testid="child-content">Content</div>
        </AuthBoundary>
      );

      expect(screen.queryByText('builder_common_signin_required')).not.toBeInTheDocument();
    });

    it.each([
      '/explore/airo-build-a-thon',
      '/explore/games',
      '/explore/games/',
      '/explore/games/hi',
    ])('should skip auth boundary on explore landing %s', async (explorePath) => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue(explorePath);

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div data-testid="child-content">Landing Content</div>
        </AuthBoundary>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.queryByText('builder_common_signin_required')).not.toBeInTheDocument();
    });

    it('should show modal on unknown explore slug after SSO dismiss', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/explore/__test-not-a-landing__');

      const { rerender } = render(
        <AuthBoundary>
          <div data-testid="child-content">Content</div>
        </AuthBoundary>
      );

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });
      act(() => {
        useAuthUIStore.getState().closeSsoLogin('dismiss');
      });

      rerender(
        <AuthBoundary>
          <div data-testid="child-content">Content</div>
        </AuthBoundary>
      );

      expect(screen.getByText('builder_common_signin_required')).toBeInTheDocument();
    });
  });

  describe('SSO auto-open', () => {
    it('should not auto-open SSO on homepage', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/');

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div data-testid="child-content">Content</div>
        </AuthBoundary>
      );

      expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
    });

    it('should not auto-open SSO on landing pages', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/explore/games');

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div data-testid="child-content">Content</div>
        </AuthBoundary>
      );

      expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
    });

    it('should not re-open SSO after user dismisses (loop guard)', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });

      const { rerender } = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Auto-open should have fired
      expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

      // User dismisses SSO modal
      act(() => {
        useAuthUIStore.getState().closeSsoLogin('dismiss');
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Should NOT re-open - user already dismissed
      expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
    });

    it('should not spuriously re-open SSO when 401 fires while SSO already open', () => {
      // SSO is already open (e.g. from session expiration banner)
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
      });

      const { rerender } = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Concurrent 401 fires while SSO is open
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });

      // User completes auth - SSO closes with success before clearNeedsReauth arrives
      act(() => {
        useAuthUIStore.getState().closeSsoLogin('success');
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Should NOT re-open SSO - auth was already handled
      expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(false);
    });

    it('should auto-open again after successful auth clears state', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });

      const { rerender } = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);

      // Auth succeeds - clear state
      act(() => {
        useAuthUIStore.getState().closeSsoLogin('success');
        useAuthUIStore.getState().clearNeedsReauth();
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // New 401 - should auto-open again since state was cleared
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      expect(useAuthUIStore.getState().isSsoLoginOpen).toBe(true);
    });
  });

  describe('analytics tracking', () => {
    /** Helper: render AuthBoundary, trigger 401, dismiss SSO, rerender to show fallback */
    function renderWithDismissedSso(reason: 'not_authenticated' | 'session_expired' | 'session_stale' = 'not_authenticated') {
      const result = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );
      act(() => { useAuthUIStore.getState().setNeedsReauth(reason); });
      act(() => { useAuthUIStore.getState().closeSsoLogin('dismiss'); });
      result.rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );
      return result;
    }

    it('should log analytics when fallback modal is shown', () => {
      renderWithDismissedSso('not_authenticated');

      expect(shipAnalyticsLog).toHaveBeenCalledWith('auth.boundary.modal_shown', {
        reason: 'not_authenticated',
        pathname: '/develop'
      });
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
    });

    it('should not log duplicate analytics on re-render', () => {
      const { rerender } = renderWithDismissedSso('session_expired');

      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);

      // Re-render with same state
      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Should still only be called once
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
    });

    it('should log again when modal is dismissed and re-shown (flag resets)', () => {
      const { rerender } = renderWithDismissedSso('not_authenticated');

      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);

      // Hide modal by clearing reauth state
      act(() => {
        useAuthUIStore.getState().clearNeedsReauth();
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Show modal again (new 401 cycle: auto-opens SSO, user dismisses)
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });
      act(() => {
        useAuthUIStore.getState().closeSsoLogin('dismiss');
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Should be called twice (once for each time fallback modal was shown)
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(2);
      expect(shipAnalyticsLog).toHaveBeenNthCalledWith(2, 'auth.boundary.modal_shown', {
        reason: 'session_expired',
        pathname: '/develop'
      });
    });

    it('should not log duplicate events when pathname changes during modal display', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/develop');

      const { rerender } = renderWithDismissedSso('not_authenticated');

      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
      expect(shipAnalyticsLog).toHaveBeenCalledWith('auth.boundary.modal_shown', {
        reason: 'not_authenticated',
        pathname: '/develop'
      });

      // Pathname changes while modal is still visible
      usePathname.mockReturnValue('/settings');

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Should still only be 1 call (doesn't re-log on pathname change)
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
    });

    it('should not log duplicate events when reason changes during modal display', () => {
      const { rerender } = renderWithDismissedSso('not_authenticated');

      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
      expect(shipAnalyticsLog).toHaveBeenCalledWith('auth.boundary.modal_shown', {
        reason: 'not_authenticated',
        pathname: '/develop'
      });

      // Reason changes while modal is still visible (edge case but possible)
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Should still only be 1 call (doesn't re-log on reason change)
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
    });

    it('should not log analytics on homepage even when needsReauth is set', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/');

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      expect(shipAnalyticsLog).not.toHaveBeenCalled();
    });

    it('should not log analytics when SSO modal is auto-opened', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // SSO auto-opened, fallback not shown yet
      expect(shipAnalyticsLog).not.toHaveBeenCalled();
    });

    it('should include correct pathname in analytics', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/develop/settings');

      renderWithDismissedSso('session_stale');

      expect(shipAnalyticsLog).toHaveBeenCalledWith('auth.boundary.modal_shown', {
        reason: 'session_stale',
        pathname: '/develop/settings'
      });
    });

    it('should handle analytics errors gracefully without breaking UI', async () => {
      const { logger } = await import('@/lib/request-context');
      const mockError = new Error('Analytics service unavailable');
      vi.mocked(shipAnalyticsLog).mockImplementationOnce(() => {
        throw mockError;
      });

      const { rerender } = render(
        <AuthBoundary>
          <div data-testid="child-content">Content</div>
        </AuthBoundary>
      );

      act(() => { useAuthUIStore.getState().setNeedsReauth('not_authenticated'); });
      act(() => { useAuthUIStore.getState().closeSsoLogin('dismiss'); });

      rerender(
        <AuthBoundary>
          <div data-testid="child-content">Content</div>
        </AuthBoundary>
      );

      // Modal should still be visible despite analytics failure
      expect(screen.getByText('builder_common_signin_required')).toBeInTheDocument();
      expect(screen.getByTestId('child-content')).toBeInTheDocument();

      // Error should be logged
      expect(logger.error).toHaveBeenCalledWith('auth.boundary.analytics-failed', {
        error: mockError
      });
    });

    it('should not double-fire analytics when SSO modal is dismissed again after retry', () => {
      const { rerender } = renderWithDismissedSso('not_authenticated');

      // Fallback modal shows, analytics logs once
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
      expect(screen.getByText('builder_common_signin_required')).toBeInTheDocument();

      // User clicks "Sign In" button from fallback - SSO modal opens again
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Auth boundary modal hidden while SSO is open
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);

      // User dismisses SSO modal again without completing sign-in
      act(() => {
        useAuthUIStore.getState().closeSsoLogin('dismiss');
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Auth boundary modal re-appears, but should NOT log again
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
      expect(screen.getByText('builder_common_signin_required')).toBeInTheDocument();
    });
  });
});
