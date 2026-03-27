/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock return values — mutated between tests
let mockConfigLoading = false;
let mockAuthLoading = false;
let mockIsAuthenticated = true;
let mockIsAuthDisabled = true;
let mockIsMockAuth = false;

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockAuthLoading,
    isAuthDisabled: mockIsAuthDisabled,
    isMockAuth: mockIsMockAuth,
  }),
}));

vi.mock('@/hooks/useGasketConfig', () => ({
  useGasketConfig: () => ({ isLoading: mockConfigLoading }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('./LoadingComponent', () => ({
  default: () => <div data-testid="loading-component">Loading...</div>,
}));

vi.mock('./UnauthorizedComponent', () => ({
  default: ({ unauthorizedMessage }: { unauthorizedMessage: string }) => (
    <div data-testid="unauthorized">{unauthorizedMessage}</div>
  ),
}));

import ProtectedRoute from './ProtectedRoute';

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigLoading = false;
    mockAuthLoading = false;
    mockIsAuthenticated = true;
    mockIsAuthDisabled = true;
    mockIsMockAuth = false;
  });

  it('renders children after hydration when auth is disabled', () => {
    mockIsAuthDisabled = true;

    render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('shows LoadingComponent when configLoading is true on initial load', () => {
    mockConfigLoading = true;

    render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('loading-component')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('shows LoadingComponent when authLoading is true on initial load', () => {
    mockAuthLoading = true;

    render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('loading-component')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('keeps children mounted when authLoading flips back to true after initial resolution', () => {
    // The loading guard fires before any auth-mode branch (disabled/mock/JWT),
    // so this test covers all downstream modes.
    mockConfigLoading = false;
    mockAuthLoading = false;

    const { rerender } = render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    // Children should be visible (auth disabled mode renders children directly)
    expect(screen.getByTestId('child-content')).toBeInTheDocument();

    // Simulate heartbeat revalidation — authLoading flips back to true
    mockAuthLoading = true;

    rerender(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    // Children should STILL be mounted — this is the key behavioral guarantee
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument();
  });

  it('keeps children mounted when configLoading flips back to true after initial resolution', () => {
    mockConfigLoading = false;
    mockAuthLoading = false;

    const { rerender } = render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();

    // Simulate config reload
    mockConfigLoading = true;

    rerender(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    // Children should STILL be mounted
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument();
  });

  it('shows UnauthorizedComponent for unauthenticated mock auth users', () => {
    mockIsMockAuth = true;
    mockIsAuthDisabled = false;
    mockIsAuthenticated = false;

    render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('unauthorized')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });
});
