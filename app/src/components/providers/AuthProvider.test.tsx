/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
  isAuthDisabled: false,
  authType: 'jwt',
  isMockAuth: false,
  mockAuth: null,
};

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuthReturn,
}));

vi.mock('@/lib/gasket-config', () => ({
  getGasketConfig: vi.fn().mockResolvedValue({ auth: { isJWT: false } }),
  isAuthJWTSync: vi.fn(() => false),
  isAuthMockSync: vi.fn(() => false),
  isAuthDisabledSync: vi.fn(() => true),
  getAuthTypeSync: vi.fn(() => 'none'),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
