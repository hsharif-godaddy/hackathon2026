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

describe('AuthBoundary', () => {
  beforeEach(async () => {
    // Reset the store to initial state before each test
    act(() => {
      useAuthUIStore.setState({
        isSsoLoginOpen: false,
        isSsoLoading: true,
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

  it('should show modal when needsReauth is true', () => {
    act(() => {
      useAuthUIStore.getState().setNeedsReauth('not_authenticated');
    });

    render(
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

  it('should show session stale message', () => {
    act(() => {
      useAuthUIStore.getState().setNeedsReauth('session_stale');
    });

    render(
      <AuthBoundary>
        <div>Content</div>
      </AuthBoundary>
    );

    expect(screen.getByText('auth_boundary_session_stale')).toBeInTheDocument();
  });

  it('should show session expired message', () => {
    act(() => {
      useAuthUIStore.getState().setNeedsReauth('session_expired');
    });

    render(
      <AuthBoundary>
        <div>Content</div>
      </AuthBoundary>
    );

    expect(screen.getByText('auth_boundary_session_expired')).toBeInTheDocument();
  });

  it('should call openSsoLogin when Sign In button is clicked', () => {
    act(() => {
      useAuthUIStore.getState().setNeedsReauth('not_authenticated');
    });

    render(
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

    it('should show modal on unknown explore slug', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/explore/__test-not-a-landing__');

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div data-testid="child-content">Content</div>
        </AuthBoundary>
      );

      expect(screen.getByText('builder_common_signin_required')).toBeInTheDocument();
    });
  });

  describe('analytics tracking', () => {
    it('should log analytics when modal is shown', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      expect(shipAnalyticsLog).toHaveBeenCalledWith('auth.boundary.modal_shown', {
        reason: 'not_authenticated',
        pathname: '/develop'
      });
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
    });

    it('should not log duplicate analytics on re-render', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });

      const { rerender } = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

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
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      const { rerender } = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

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

      // Show modal again
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_expired');
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Should be called twice (once for each time modal was shown)
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(2);
      expect(shipAnalyticsLog).toHaveBeenNthCalledWith(2, 'auth.boundary.modal_shown', {
        reason: 'session_expired',
        pathname: '/develop'
      });
    });

    it('should not log duplicate events when pathname changes during modal display', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/develop');

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      const { rerender } = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

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
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      const { rerender } = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

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

    it('should not log analytics when SSO modal is already open', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
        useAuthUIStore.getState().openSsoLogin();
      });

      render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      expect(shipAnalyticsLog).not.toHaveBeenCalled();
    });

    it('should include correct pathname in analytics', async () => {
      const { usePathname } = vi.mocked(await import('next/navigation'));
      usePathname.mockReturnValue('/develop/settings');

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('session_stale');
      });

      render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

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

      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      // Should not throw - component should render successfully
      expect(() => {
        render(
          <AuthBoundary>
            <div data-testid="child-content">Content</div>
          </AuthBoundary>
        );
      }).not.toThrow();

      // Modal should still be visible despite analytics failure
      expect(screen.getByText('builder_common_signin_required')).toBeInTheDocument();
      expect(screen.getByTestId('child-content')).toBeInTheDocument();

      // Error should be logged
      expect(logger.error).toHaveBeenCalledWith('auth.boundary.analytics-failed', {
        error: mockError
      });
    });

    it('should not double-fire analytics when SSO modal is dismissed without sign-in', () => {
      act(() => {
        useAuthUIStore.getState().setNeedsReauth('not_authenticated');
      });

      const { rerender } = render(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Modal shows, analytics logs once
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);

      // User clicks "Sign In" button - SSO modal opens
      act(() => {
        useAuthUIStore.getState().openSsoLogin();
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Auth boundary modal hidden, but analytics should still only be 1 call
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);

      // User dismisses SSO modal without completing sign-in
      act(() => {
        useAuthUIStore.getState().closeSsoLogin('dismiss');
      });

      rerender(
        <AuthBoundary>
          <div>Content</div>
        </AuthBoundary>
      );

      // Auth boundary modal re-appears (needsReauth still true), but should NOT log again
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);
      expect(screen.getByText('builder_common_signin_required')).toBeInTheDocument();
    });
  });
});
