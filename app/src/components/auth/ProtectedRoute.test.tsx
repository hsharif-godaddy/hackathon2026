/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock return values -- mutated between tests
let mockConfigLoading = false;
let mockAuthLoading = false;
let mockIsAuthenticated = true;
let mockIsMockAuth = false;

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockAuthLoading,
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

vi.mock('./SsoLoginPrompt', () => ({
  default: () => <div data-testid="sso-login-prompt">Sign In</div>,
}));

import ProtectedRoute from './ProtectedRoute';

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigLoading = false;
    mockAuthLoading = false;
    mockIsAuthenticated = true;
    mockIsMockAuth = false;
  });

  it('renders children when authenticated in mock mode', () => {
    mockIsMockAuth = true;
    mockIsAuthenticated = true;

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
    mockIsMockAuth = true;
    mockConfigLoading = false;
    mockAuthLoading = false;

    const { rerender } = render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();

    mockAuthLoading = true;

    rerender(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument();
  });

  it('keeps children mounted when configLoading flips back to true after initial resolution', () => {
    mockIsMockAuth = true;
    mockConfigLoading = false;
    mockAuthLoading = false;

    const { rerender } = render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();

    mockConfigLoading = true;

    rerender(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument();
  });

  it('shows SsoLoginPrompt for unauthenticated mock auth users', () => {
    mockIsMockAuth = true;
    mockIsAuthenticated = false;

    render(
      <ProtectedRoute>
        <div data-testid="child-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('sso-login-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });
});
