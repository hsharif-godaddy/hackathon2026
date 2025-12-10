import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import { mockAuthContext, mockSearchParams, mockParams } from '@/tests/mocks';
import Header from './Header';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mockSearchParams(),
  useParams: () => mockParams(),
  usePathname: () => '/',
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext({ isAuthenticated: false, isAuthDisabled: true }),
}));
vi.mock('@/stores/useSitesStore', () => ({
  useSites: () => ({ sites: [], isLoading: false }),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => {
    const state = {
      publishStates: {},
      getPublishState: vi.fn(() => ({
        deploymentInProgressId: null,
        isPollingActive: false,
      })),
    };
    return selector ? selector(state) : false;
  },
}));

describe('Header', () => {
  it('should render without crashing', () => {
    renderWithProviders(<Header />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('should render Airo logo link', () => {
    renderWithProviders(<Header />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://airo.ai');
  });

  it('should render beta tag', () => {
    renderWithProviders(<Header />);

    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('should apply homepage styling when location is homepage', () => {
    const { container } = renderWithProviders(<Header location="homepage" />);

    const header = container.querySelector('header');
    expect(header).not.toHaveClass('header-bg');
  });

  it('should apply non-homepage styling when location is not homepage', () => {
    const { container } = renderWithProviders(<Header location="develop" />);

    const header = container.querySelector('header');
    expect(header).toHaveClass('header-bg');
  });

  it('should render custom actions when provided', () => {
    renderWithProviders(
      <Header actions={<button data-testid="custom-action">Custom Action</button>} />
    );

    expect(screen.getByTestId('custom-action')).toBeInTheDocument();
  });

  it('should not render custom actions when not provided', () => {
    renderWithProviders(<Header />);

    expect(screen.queryByTestId('custom-action')).not.toBeInTheDocument();
  });
});
