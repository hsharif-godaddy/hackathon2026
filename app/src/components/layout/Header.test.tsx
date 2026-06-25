/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { mockAuthContext, mockParams, mockSearchParams } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import Header from './Header';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => mockSearchParams(),
  useParams: () => mockParams(),
  usePathname: () => '/',
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id) { return id; }),
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(() => mockAuthContext({ isAuthenticated: false })),
}));
vi.mock('@site/notifications', () => ({
  default: ({ id }: { id: string }) => <div data-testid={id} />,
}));
vi.mock('@/stores/useSitesStore', () => ({
  useSites: () => ({ sites: [], isLoading: false }),
  useSitesStore: vi.fn(function () { return { fetchSite: vi.fn() }; }),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => {
    const state = {
      publishStates: {},
      getPublishState: vi.fn(function () { return {
        deploymentInProgressId: null,
        isPollingActive: false,
      }; }),
      activeChatTab: 'chat',
      activeSettingsSection: 'domain',
      chatTabsInitializedForPathname: null,
      setActiveChatTab: vi.fn(),
      setActiveSettingsSection: vi.fn(),
      markChatTabsInitialized: vi.fn(),
    };
    return selector ? selector(state) : false;
  },
}));

describe('Header', () => {
  beforeEach(() => {
    vi.mocked(useAuthContext).mockReturnValue(mockAuthContext({ isAuthenticated: false }));
  });

  it('should render without crashing', () => {
    renderWithProviders(<Header />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('should render Airo logo link', () => {
    renderWithProviders(<Header />);

    const links = screen.getAllByRole('link');
    const airoLink = links.find(link => link.getAttribute('href') === '/');
    expect(airoLink).toBeInTheDocument();
  });

  it('should render GoDaddy logo link on homepage', () => {
    renderWithProviders(<Header location="homepage" />);

    const godaddyLink = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(godaddyLink).toBeInTheDocument();
  });

  it('should render GoDaddy logo link on marketing landing pages', () => {
    renderWithProviders(<Header location="landing-games" />);

    const godaddyLink = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(godaddyLink).toBeInTheDocument();
  });

  it('should not render GoDaddy logo link on internal pages', () => {
    renderWithProviders(<Header location="sites" />);

    expect(screen.queryByRole('link', { name: 'builder_common_back_godaddy' })).not.toBeInTheDocument();
  });

  it('should not render GoDaddy logo link on manage plan', () => {
    renderWithProviders(<Header location="manage-plan" />);

    expect(screen.queryByRole('link', { name: 'builder_common_back_godaddy' })).not.toBeInTheDocument();
  });

  it('should render beta tag', () => {
    renderWithProviders(<Header />);

    expect(screen.getByText('builder_beta')).toBeInTheDocument();
  });

  it('should apply homepage styling when location is homepage', () => {
    const { container } = renderWithProviders(<Header location="homepage" />);

    const header = container.querySelector('header');
    expect(header).not.toHaveClass('bg-gradient');
  });

  it('should apply non-homepage styling when location is not homepage', () => {
    const { container } = renderWithProviders(<Header location="develop" />);

    const header = container.querySelector('header');
    expect(header).toHaveClass('bg-gradient');
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

  it('should render Notifications on homepage when authenticated', () => {
    vi.mocked(useAuthContext).mockReturnValue(mockAuthContext({ isAuthenticated: true }));
    renderWithProviders(<Header location="homepage" />);

    expect(screen.getByTestId('site-notifications-homepage')).toBeInTheDocument();
  });

  it('should not render Notifications on homepage when not authenticated', () => {
    renderWithProviders(<Header location="homepage" />);

    expect(screen.queryByTestId('site-notifications-homepage')).not.toBeInTheDocument();
  });
});
