/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { mockBreakpoints, mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import Loading from './loading';

vi.mock('@/utils/instrumentation', () => mockInstrumentation());

const mockUseBreakpoints = vi.fn(() => mockBreakpoints());
vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => mockUseBreakpoints(),
}));

describe('Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockUseBreakpoints.mockReturnValue(mockBreakpoints());
  });

  it('should render the develop skeleton with header on desktop', () => {
    renderWithProviders(<Loading />);

    expect(screen.getByTestId('develop-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByTestId('develop-skeleton-preview')).toBeInTheDocument();
  });

  it('should render the develop skeleton with mobile layout', () => {
    mockUseBreakpoints.mockReturnValue(mockBreakpoints({ isBelowSmBreakpoint: true }));
    renderWithProviders(<Loading />);

    expect(screen.getByTestId('develop-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.queryByTestId('develop-skeleton-preview')).not.toBeInTheDocument();
  });
});
