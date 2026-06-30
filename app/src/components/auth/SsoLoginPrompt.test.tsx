/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { useAuthUIStore } from '@/stores/useAuthUIStore';
import SsoLoginPrompt from './SsoLoginPrompt';

const mockSignIn = vi.fn();
const mockIsMockAuth = { current: false };

let mockShouldAttempt: boolean = false;
const mockAwaitRecovery = vi.fn();

vi.mock('@/lib/auth/heartbeat-patience', () => ({
  shouldAttemptHeartbeatPatience: () => mockShouldAttempt,
  awaitHeartbeatRecovery: (...args: unknown[]) => mockAwaitRecovery(...args),
  HEARTBEAT_PATIENCE_RELOAD_KEY: '__airo_heartbeat_patience_reload',
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

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
  default: ({ children, onClick, icon, text }: any) => (
    <button type="button" onClick={onClick}>{icon}{text}{children}</button>
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
    mockShouldAttempt = false;
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
    mockSignIn.mockImplementation(function (opts: { onShowMockLogin?: () => void }) {
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
    mockSignIn.mockImplementation(function (opts: { onShowMockLogin?: () => void }) {
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

describe('SsoLoginPrompt heartbeat patience (shared helper)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockIsMockAuth.current = false;
    mockShouldAttempt = true;
  });

  it('does not call signIn while patience is running', async () => {
    mockAwaitRecovery.mockReturnValue(new Promise(() => {}));

    render(<SsoLoginPrompt />);

    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockAwaitRecovery).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('calls signIn when recovery fails', async () => {
    mockAwaitRecovery.mockResolvedValue({ recovered: false });

    render(<SsoLoginPrompt />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not call signIn when recovery succeeds (reload happens)', async () => {
    mockAwaitRecovery.mockResolvedValue({ recovered: true });

    render(<SsoLoginPrompt />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('skips patience when shouldAttemptHeartbeatPatience returns false', () => {
    mockShouldAttempt = false;

    render(<SsoLoginPrompt />);

    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockAwaitRecovery).not.toHaveBeenCalled();
  });

  it('aborts recovery on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockAwaitRecovery.mockImplementation((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const { unmount } = render(<SsoLoginPrompt />);

    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
