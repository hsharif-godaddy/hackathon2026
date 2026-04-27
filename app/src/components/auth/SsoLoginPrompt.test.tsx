/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { useAuthUIStore } from '@/stores/useAuthUIStore';
import SsoLoginPrompt from './SsoLoginPrompt';

const mockSignIn = vi.fn();
const mockIsMockAuth = { current: false };

vi.mock('@/hooks/useSsoSignIn', () => ({
  useSsoSignIn: () => ({ signIn: mockSignIn }),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({ isMockAuth: mockIsMockAuth.current }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@ux/button', () => ({
  __esModule: true,
  default: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@ux/spinner', () => ({
  __esModule: true,
  default: () => <div data-testid="spinner" />,
}));

vi.mock('./MockLogin', () => ({
  MockLoginDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="mock-login-dialog" /> : null,
}));

function resetStore() {
  useAuthUIStore.setState({
    isSsoLoginOpen: false,
    isSsoLoading: true,
    ssoCloseReason: null,
    ssoAuthReason: null,
    redirectUrl: null,
  });
}

describe('SsoLoginPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockIsMockAuth.current = false;
  });

  it('calls signIn exactly once on mount via ref guard', () => {
    const { rerender } = render(<SsoLoginPrompt />);
    rerender(<SsoLoginPrompt />);
    rerender(<SsoLoginPrompt />);

    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('shows retry button when SSO is dismissed and re-fires signIn on retry', () => {
    render(<SsoLoginPrompt />);
    expect(mockSignIn).toHaveBeenCalledTimes(1);

    act(() => {
      useAuthUIStore.getState().closeSsoLogin('dismiss');
    });

    const retryButton = screen.getByRole('button', { name: 'builder_common_signin' });
    expect(retryButton).toBeInTheDocument();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(useAuthUIStore.getState().ssoCloseReason).toBeNull();

    fireEvent.click(retryButton);

    expect(mockSignIn).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('renders MockLoginDialog when isMockAuth and onShowMockLogin fires', () => {
    mockIsMockAuth.current = true;
    let onShowMockLogin: (() => void) | undefined;
    mockSignIn.mockImplementation((opts: { onShowMockLogin?: () => void }) => {
      onShowMockLogin = opts.onShowMockLogin;
    });

    render(<SsoLoginPrompt />);

    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mock-login-dialog')).not.toBeInTheDocument();

    act(() => {
      onShowMockLogin?.();
    });

    expect(screen.getByTestId('mock-login-dialog')).toBeInTheDocument();
  });

  it('does not render MockLoginDialog when isMockAuth=false even if callback fires', () => {
    let onShowMockLogin: (() => void) | undefined;
    mockSignIn.mockImplementation((opts: { onShowMockLogin?: () => void }) => {
      onShowMockLogin = opts.onShowMockLogin;
    });

    render(<SsoLoginPrompt />);

    act(() => {
      onShowMockLogin?.();
    });

    expect(screen.queryByTestId('mock-login-dialog')).not.toBeInTheDocument();
  });

  it('does not show retry button when SSO closes with success', () => {
    render(<SsoLoginPrompt />);

    act(() => {
      useAuthUIStore.getState().closeSsoLogin('success');
    });

    expect(screen.queryByRole('button', { name: 'builder_common_signin' })).not.toBeInTheDocument();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });
});
