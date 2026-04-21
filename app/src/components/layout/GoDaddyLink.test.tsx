/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { mockAuthContext } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import GoDaddyLink from './GoDaddyLink';

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(),
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));
vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: vi.fn(() => 'godaddy.com'),
}));

const { useAuthContext } = await import('@/components/providers/AuthProvider');

describe('GoDaddyLink', () => {
  it('should render link to godaddy.com when unauthenticated', () => {
    vi.mocked(useAuthContext).mockReturnValue(
      mockAuthContext({ isAuthenticated: false, isAuthDisabled: false, isLoading: false })
    );

    renderWithProviders(<GoDaddyLink location="homepage" />);

    const link = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(link).toHaveAttribute('href', 'https://www.godaddy.com');
  });

  it('should render link to My Products when authenticated', () => {
    vi.mocked(useAuthContext).mockReturnValue(
      mockAuthContext({ isAuthenticated: true, isLoading: false })
    );

    renderWithProviders(<GoDaddyLink location="homepage" />);

    const link = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(link).toHaveAttribute('href', 'https://account.godaddy.com/products');
  });

  it('should render link to godaddy.com when loading', () => {
    vi.mocked(useAuthContext).mockReturnValue(
      mockAuthContext({ isAuthenticated: false, isLoading: true })
    );

    renderWithProviders(<GoDaddyLink location="homepage" />);

    const link = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(link).toHaveAttribute('href', 'https://www.godaddy.com');
  });

  it('should render link to My Products when auth is disabled', () => {
    vi.mocked(useAuthContext).mockReturnValue(
      mockAuthContext({ isAuthenticated: false, isAuthDisabled: true, isLoading: false })
    );

    renderWithProviders(<GoDaddyLink location="homepage" />);

    const link = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(link).toHaveAttribute('href', 'https://account.godaddy.com/products');
  });

  it('should apply custom className', () => {
    vi.mocked(useAuthContext).mockReturnValue(
      mockAuthContext({ isAuthenticated: false, isLoading: false })
    );

    renderWithProviders(<GoDaddyLink location="homepage" className="custom-class" />);

    const link = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(link).toHaveClass('custom-class');
  });

  it('should include EID based on location', () => {
    vi.mocked(useAuthContext).mockReturnValue(
      mockAuthContext({ isAuthenticated: false, isLoading: false })
    );

    renderWithProviders(<GoDaddyLink location="develop" />);

    const link = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(link).toHaveAttribute('data-eid', 'develop.header.godaddy_logo');
  });
});
