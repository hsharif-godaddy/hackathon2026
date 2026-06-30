/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

// Control the mock return value from useAuth
let mockUseAuthReturn = {
  isAuthenticated: false,
  isLoading: true,
  authState: null,
  needsReauth: false,
  config: null,
  gasketConfig: null,
  configLoading: false,
  configError: null,
  getUserEmail: () => 'test@example.com',
  getUserInfo: () => ({
    customerId: 'test',
    shopperId: 'test',
    accountName: 'Test',
    email: 'test@example.com',
  }),
  handleSignIn: vi.fn(),
  handleSignOut: vi.fn(),

  authType: 'jwt',
  isMockAuth: false,
  mockAuth: null,
};

let mockShouldAttempt: boolean = false;
const mockAwaitRecovery = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuthReturn,
}));

vi.mock('@/lib/auth/heartbeat-patience', () => ({
  shouldAttemptHeartbeatPatience: () => mockShouldAttempt,
  awaitHeartbeatRecovery: (...args: unknown[]) => mockAwaitRecovery(...args),
  HEARTBEAT_PATIENCE_RELOAD_KEY: '__airo_heartbeat_patience_reload',
}));

vi.mock('@/lib/gasket-config', () => ({
  getGasketConfig: vi.fn().mockResolvedValue({ auth: { isJWT: false } }),
  isAuthJWTSync: vi.fn(function () { return false; }),
  isAuthMockSync: vi.fn(function () { return false; }),

  getAuthTypeSync: vi.fn(function () { return 'mock'; }),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/components/auth/LoadingComponent', () => ({
  default: () => <div data-testid="loading-component">Loading...</div>,
}));

// Import after mocks are set up
// Since InnerAuthProvider is not exported, we test it through AuthProvider
import AuthProvider from './AuthProvider';

describe('InnerAuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to loading state
    mockUseAuthReturn = {
      ...mockUseAuthReturn,
      isLoading: true,
      isAuthenticated: false,
    };
  });

  it('shows LoadingComponent during initial auth check', async () => {
    render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    // Wait for AuthProvider's async setup to complete
    // The inner provider should show loading since useAuth returns isLoading: true
    await screen.findByTestId('loading-component');
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('renders children after auth resolves', async () => {
    mockUseAuthReturn = { ...mockUseAuthReturn, isLoading: false, isAuthenticated: true };

    render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    await screen.findByTestId('child-content');
    expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument();
  });

  it('keeps children mounted when isLoading flips back to true after initial resolution', async () => {
    // Start with auth resolved
    mockUseAuthReturn = { ...mockUseAuthReturn, isLoading: false, isAuthenticated: true };

    const { rerender } = render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    // Children should be visible
    await screen.findByTestId('child-content');

    // Simulate heartbeat revalidation — isLoading flips back to true
    mockUseAuthReturn = { ...mockUseAuthReturn, isLoading: true };

    rerender(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    // Children should STILL be mounted — this is the key behavioral guarantee
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument();
  });
});

describe('AuthProvider heartbeat patience (cold launch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldAttempt = true;
    mockUseAuthReturn = {
      ...mockUseAuthReturn,
      isLoading: false,
      isAuthenticated: false,
    };
  });

  it('holds loading while patience is running', async () => {
    mockAwaitRecovery.mockReturnValue(new Promise(() => {}));

    render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    // Wait for outer AuthProvider async setup + InnerAuthProvider effect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId('loading-component')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    expect(mockAwaitRecovery).toHaveBeenCalledTimes(1);
  });

  it('renders children when recovery fails (genuine logout)', async () => {
    mockAwaitRecovery.mockResolvedValue({ recovered: false });

    render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    // Allow outer AuthProvider async loading + InnerAuthProvider effect + recovery promise chain
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await screen.findByTestId('child-content');
  });

  it('does not render children when recovery succeeds (reload pending)', async () => {
    mockAwaitRecovery.mockResolvedValue({ recovered: true });

    render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    // Wait for promise to resolve
    await act(async () => { await Promise.resolve(); });

    // Still showing loading — reload is pending
    expect(screen.getByTestId('loading-component')).toBeInTheDocument();
  });

  it('skips patience when shouldAttemptHeartbeatPatience returns false', async () => {
    mockShouldAttempt = false;

    render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    await screen.findByTestId('child-content');
    expect(mockAwaitRecovery).not.toHaveBeenCalled();
  });

  it('does not activate patience when user is authenticated', async () => {
    mockUseAuthReturn = { ...mockUseAuthReturn, isLoading: false, isAuthenticated: true };

    render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    await screen.findByTestId('child-content');
    expect(mockAwaitRecovery).not.toHaveBeenCalled();
  });

  it('aborts recovery on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockAwaitRecovery.mockImplementation((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const { unmount } = render(
      <AuthProvider>
        <div data-testid="child-content">App Content</div>
      </AuthProvider>
    );

    await screen.findByTestId('loading-component');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
