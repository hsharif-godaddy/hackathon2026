/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import AnalyticsPanel from './AnalyticsPanel';

const mockGetSite = vi.fn();
const mockUseSwitchboard = vi.fn();
const mockUsePublishedUrl = vi.fn();
const mockHasBeenPublished = vi.fn();

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'test-app-123',
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: (state: { getSite: typeof mockGetSite }) => unknown) =>
    selector({ getSite: mockGetSite }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (...args: unknown[]) => mockUseSwitchboard(...args),
}));

vi.mock('@/app/[market]/develop/hooks/usePublishedUrl', () => ({
  usePublishedUrl: () => mockUsePublishedUrl(),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: (...args: unknown[]) => mockHasBeenPublished(...args),
}));

vi.mock('@/app/[market]/develop/components/settings/DomainPanel/usePublishForDomain', () => ({
  usePublishForDomain: () => ({
    handlePublish: vi.fn(),
    isPublishDisabled: false,
    publishState: { isPublishing: false },
  }),
}));

vi.mock('@/hooks/usePaywallModal', () => ({
  usePaywallModal: () => ({
    checkAndShowPaywall: vi.fn((cb: () => unknown) => cb()),
    PaywallModal: () => null,
    isPaywallLoading: false,
    isPublishLimitLoading: false,
  }),
}));

const mockUseSubscription = vi.fn();

// Mock the data hooks RUM depends on so it can render its full UI tree
// without hitting the network. RUM itself is rendered for real.
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

vi.mock('@/hooks/useInsightsAnalytics', () => ({
  useInsightsAnalytics: () => ({
    dailyPageViews: [],
    dailyClicks: [],
    routePageViews: [],
    totalPageViews: 0,
    totalClicks: 0,
    buttonClicks: 0,
    linkClicks: 0,
    visitors: 0,
    viewsPerVisit: 0,
    isLoading: false,
    isRefreshing: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useClickhouseAnalytics', () => ({
  useClickhouseAnalytics: () => ({
    totalHostPageViews: 0,
    totalHostUniqueVisitors: 0,
    dailyHostPageViews: [],
    dailyUniqueVisitors: [],
    dailyTotalSessions: [],
    pageViewsByPathData: [],
    uniqueVisitorsByPageData: [],
    pageActivityShareData: [],
    clickTrendsData: [],
    clicksByElementData: [],
    clicksPerPageData: [],
    clickActivityShareData: [],
    exitRateData: [],
    newVsReturningData: [],
    browserSessionsData: [],
    sessionsByDeviceData: [],
    countryTrafficData: [],
    cityTrafficData: [],
    pageTransitionsTableData: [],
    topReferrersData: [],
    referrerLandingDetailData: [],
    topCTALabelsData: [],
    elementSectionData: [],
    avgClicksPerSessionData: [],
    clicksByHourData: [],
    hourlyPageviewVisitorData: [],
    dailyTrendByPageData: [],
    hourlyClicksByDeviceData: [],
    deviceDistributionData: [],
    deviceMixOverTimeData: [],
    sessionClickData: [],
    elementClicksBySectionData: [],
    kpiExtras: {
      totalSessions: 0,
      bounceSessions: 0,
      bounceRate: '0%',
      peakHour: '0:00',
      peakHourClicks: 0,
      peakHourVisitors: 0,
      avgPagesPerSession: 0,
      avgSessionDuration: '0m 0s',
    },
    activityHitsData: [],
    countryTrafficWithCodeData: [],
    cityTrafficWithCountryData: [],
    browserTrendsOverTimeData: [],
    isLoading: false,
    isFetched: false,
    error: null,
  }),
}));

const starterSubscription = { plan: 'starter', productId: null, isTrial: false, hadAiroPlus: false };

describe('AnalyticsPanel', () => {
  beforeEach(() => {
    mockUseSwitchboard.mockReturnValue(true);
    mockGetSite.mockReturnValue({ id: 'test-app-123' });
    mockUsePublishedUrl.mockReturnValue('https://example.com');
    mockHasBeenPublished.mockReturnValue(true);
    mockUseSubscription.mockReturnValue({
      data: starterSubscription,
      isFetching: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while the analytics feature flag is loading', () => {
    mockUseSwitchboard.mockReturnValue(undefined);

    const { container } = renderWithProviders(<AnalyticsPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the analytics feature flag is disabled', () => {
    mockUseSwitchboard.mockReturnValue(false);

    const { container } = renderWithProviders(<AnalyticsPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the loading state while the site is unresolved', () => {
    mockGetSite.mockReturnValue(null);

    renderWithProviders(<AnalyticsPanel />);

    expect(screen.getByText('builder_common_loading')).toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_title')).not.toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_empty_title')).not.toBeInTheDocument();
  });

  it('renders the skeleton while the subscription is loading', () => {
    mockUseSubscription.mockReturnValue({
      data: undefined,
      isFetching: true,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<AnalyticsPanel />);

    expect(screen.queryByText('builder_analytics_title')).not.toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_empty_title')).not.toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_paywall_title')).not.toBeInTheDocument();
  });

  it('renders the error state when the subscription fetch fails', () => {
    mockUseSubscription.mockReturnValue({
      data: undefined,
      isFetching: false,
      isLoading: false,
      isError: true,
      error: new Error('Network error'),
      refetch: vi.fn(),
    });

    renderWithProviders(<AnalyticsPanel />);

    expect(screen.getByText('builder_common_subscription_error_title')).toBeInTheDocument();
    expect(screen.getByText('builder_common_subscription_error_desc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builder_common_retry' })).toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_paywall_title')).not.toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_title')).not.toBeInTheDocument();
  });

  it('disables the retry button while the subscription is refetching', () => {
    mockUseSubscription.mockReturnValue({
      data: undefined,
      isFetching: true,
      isLoading: false,
      isError: true,
      error: new Error('Network error'),
      refetch: vi.fn(),
    });

    renderWithProviders(<AnalyticsPanel />);

    expect(screen.getByRole('button', { name: 'builder_common_retry' })).toBeDisabled();
  });

  it('renders the paywall when the user is below Starter plan', () => {
    mockUseSubscription.mockReturnValue({
      data: undefined,
      isFetching: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<AnalyticsPanel />);

    expect(screen.getByText('builder_analytics_paywall_title')).toBeInTheDocument();
    expect(screen.getByText('builder_analytics_paywall_desc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builder_upgrade_button' })).toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_empty_title')).not.toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_title')).not.toBeInTheDocument();
  });

  it('renders the empty state when the site has not been published', () => {
    mockUsePublishedUrl.mockReturnValue(null);
    mockHasBeenPublished.mockReturnValue(false);

    renderWithProviders(<AnalyticsPanel />);

    expect(screen.getByText('builder_analytics_empty_title')).toBeInTheDocument();
    expect(screen.getByText('builder_analytics_empty_desc')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'builder_domain_publish_now' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_title')).not.toBeInTheDocument();
    expect(screen.queryByText('builder_common_loading')).not.toBeInTheDocument();
  });

  it('renders the RUM dashboard when the site is published', () => {
    renderWithProviders(<AnalyticsPanel />);

    expect(screen.getByText('builder_analytics_title')).toBeInTheDocument();
    expect(screen.queryByText('builder_analytics_empty_title')).not.toBeInTheDocument();
    expect(screen.queryByText('builder_common_loading')).not.toBeInTheDocument();
  });
});
