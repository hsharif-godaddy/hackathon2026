import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from '@testing-library/react';

import AuthBoundary from './AuthBoundary';
import { useAuthUIStore } from '@/stores/useAuthUIStore';

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
  useTranslations: () => (key: string, _params: unknown, defaultValue: string) => defaultValue,
}));

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AuthBoundary', () => {
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
    vi.clearAllMocks();
  });

  it('should render children when needsReauth is false', () => {
    render(
      <AuthBoundary>
        <div data-testid="child-content">Protected Content</div>
      </AuthBoundary>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByText('Sign In Required')).not.toBeInTheDocument();
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
    expect(screen.getByText('Sign In Required')).toBeInTheDocument();
    expect(screen.getByText('Please sign in to continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
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

    expect(screen.getByText('Your session needs to be refreshed. Please sign in to continue.')).toBeInTheDocument();
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

    expect(screen.getByText('Your session has expired. Please sign in to continue.')).toBeInTheDocument();
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

    const signInButton = screen.getByRole('button', { name: 'Sign In' });
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
    expect(screen.queryByText('Sign In Required')).not.toBeInTheDocument();
  });

  describe('homepage bypass', () => {
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
      expect(screen.queryByText('Sign In Required')).not.toBeInTheDocument();
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

      expect(screen.queryByText('Sign In Required')).not.toBeInTheDocument();
    });
  });
});
