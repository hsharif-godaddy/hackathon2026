/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import DomainConnectionStatusStepper from '@/app/[market]/develop/components/settings/components/DomainConnectionStatusStepper';
import type { ParsedJobStep } from '@/hooks/useDomainJobPolling';
import type { AiroDomainErrorResponse } from '@/lib/mgmt-airo';
import { renderWithProviders } from '@/tests/test-utils';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

const SUPPORT_URL = 'https://support.test/contact';

const { mockUseGasketConfig } = vi.hoisted(() => ({ mockUseGasketConfig: vi.fn() }));

vi.mock('@/hooks/useGasketConfig', () => ({
  useGasketConfig: () => mockUseGasketConfig(),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn((selector: (state: { getSite: (id: string) => { published_url: string } | null }) => unknown) =>
    selector({ getSite: () => ({ published_url: 'https://example.com' }) }),
  ),
}));

vi.mock('@/utils/domain-validation', () => ({
  translateDomainApiError: vi.fn((_code: string, _t: unknown, fallback?: string) => fallback ?? 'Translated error'),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id: string) => `${id}.click`),
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/app/[market]/develop/components/StaticSkeleton', () => ({
  default: ({ width, height }: { width: string; height: string }) => (
    <div data-testid="skeleton" style={{ width, height }} />
  ),
}));

const baseSteps: ParsedJobStep[] = [
  { label: 'builder_domain_job_starting_connection', status: 'SUCCESS' },
  { label: 'builder_domain_job_configuring_dns', status: 'RUNNING' },
  { label: 'builder_domain_job_verifying_domain', status: null },
];

const defaultProps = {
  fqdn: 'example.com',
  siteId: 'site-123',
  steps: baseSteps,
  overallStatus: 'RUNNING' as string | null,
  appDomainStatus: undefined as string | undefined,
  domainError: null as AiroDomainErrorResponse | null,
  onRefresh: vi.fn(),
  onDisconnect: vi.fn(),
  isRefreshing: false,
};

function buildDomainError(action: 'RETRY' | 'CONTACT_SUPPORT' | 'SELF_SERVICE'): AiroDomainErrorResponse {
  return {
    appId: 'app-1',
    fqdn: 'example.com',
    error: {
      code: 'TEST_ERROR_CODE',
      message: 'Something went wrong',
      action,
    },
  } as AiroDomainErrorResponse;
}

describe('DomainConnectionStatusStepper', function suite() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    vi.mocked(logImpressionEvent).mockReturnValue(vi.fn());
    mockUseGasketConfig.mockReturnValue({
      config: { supportUrl: SUPPORT_URL },
      isLoading: false,
      error: null,
      isRuntimeConfig: false,
    });
  });

  it('renders without crashing when the gasket config has not hydrated yet (null config)', function nullConfig() {
    mockUseGasketConfig.mockReturnValue({ config: null, isLoading: true, error: null, isRuntimeConfig: false });
    expect(() =>
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          domainError={buildDomainError('CONTACT_SUPPORT')}
        />,
      ),
    ).not.toThrow();
  });

  describe('step rendering', function stepRenderingSuite() {
    it('renders all steps including future pending ones', function stepsRendered() {
      renderWithProviders(<DomainConnectionStatusStepper {...defaultProps} />);
      expect(screen.getByText('builder_domain_job_starting_connection')).toBeInTheDocument();
      expect(screen.getByText('builder_domain_job_configuring_dns')).toBeInTheDocument();
      expect(screen.getByText('builder_domain_job_verifying_domain')).toBeInTheDocument();
    });

    it('renders a subtitle for a known step label (description key present)', function stepSubtitle() {
      renderWithProviders(<DomainConnectionStatusStepper {...defaultProps} />);
      // configuring_dns is a known step, so its `${label}_description` key renders (as the key id here)
      expect(screen.getByText('builder_domain_job_configuring_dns_description')).toBeInTheDocument();
    });

    it('omits the subtitle for an unknown step label (no description key)', function noStepSubtitle() {
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          steps={[{ label: 'builder_domain_job_unknown_step', status: 'RUNNING' }]}
        />,
      );
      expect(screen.queryByText('builder_domain_job_unknown_step_description')).not.toBeInTheDocument();
    });

    it('shows Done badge for a SUCCESS step', function successBadge() {
      // t('builder_domain_status_view_step_done', undefined, 'Done') → 'Done' (default message)
      renderWithProviders(<DomainConnectionStatusStepper {...defaultProps} />);
      expect(screen.getByText('Done')).toBeInTheDocument();
    });

    it('renders empty state without step list when steps array is empty', function emptySteps() {
      renderWithProviders(
        <DomainConnectionStatusStepper {...defaultProps} steps={[]} />,
      );
      expect(screen.queryByText('builder_domain_job_starting_connection')).not.toBeInTheDocument();
    });

    it('shows Done badge for every step when overall status is SUCCESS', function successAllDone() {
      renderWithProviders(
        <DomainConnectionStatusStepper {...defaultProps} overallStatus="SUCCESS" />,
      );
      const doneBadges = screen.getAllByText('Done');
      expect(doneBadges).toHaveLength(3);
    });

    it('shows Done badge for every step when appDomainStatus is active', function activeAllDone() {
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus={null}
          appDomainStatus="active"
        />,
      );
      const doneBadges = screen.getAllByText('Done');
      expect(doneBadges).toHaveLength(3);
    });
  });

  describe('success banner', function successBannerSuite() {
    it('shows live app button and manage domains link when overallStatus is SUCCESS', function successBanner() {
      renderWithProviders(
        <DomainConnectionStatusStepper {...defaultProps} overallStatus="SUCCESS" steps={[]} />,
      );
      // Copy lives only in i18n now (no defaultMessage): with the empty test catalog, react-intl
      // renders each key as its id, so we assert on the key.
      expect(screen.getByText('builder_domain_status_view_success_headline')).toBeInTheDocument();
      expect(screen.getByText('builder_domain_status_view_live_app')).toBeInTheDocument();
      expect(screen.getByText('builder_domain_status_view_manage_domains')).toBeInTheDocument();
    });

    it('shows success banner when appDomainStatus is active', function successBannerActive() {
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus={null}
          appDomainStatus="active"
          steps={[]}
        />,
      );
      expect(screen.getByText('builder_domain_status_view_success_headline')).toBeInTheDocument();
    });

    it('does not show success banner when status is RUNNING', function noSuccessBannerRunning() {
      renderWithProviders(
        <DomainConnectionStatusStepper {...defaultProps} overallStatus="RUNNING" />,
      );
      expect(screen.queryByText('builder_domain_status_view_live_app')).not.toBeInTheDocument();
    });
  });

  describe('error CTA variants', function errorCtaSuite() {
    it('shows Retry button and contact support when action is RETRY', function retryAction() {
      const failedSteps: ParsedJobStep[] = [
        { label: 'builder_domain_job_starting_connection', status: 'SUCCESS' },
        { label: 'builder_domain_job_configuring_dns', status: 'FAILED' },
      ];
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          steps={failedSteps}
          domainError={buildDomainError('RETRY')}
        />,
      );
      // t('builder_domain_status_view_retry', undefined, 'Retry connection')
      expect(screen.getByText('Retry connection')).toBeInTheDocument();
      // t('builder_common_contact_support', undefined, 'Contact support')
      expect(screen.getByText('Contact support')).toBeInTheDocument();
    });

    it('shows only contact support when action is CONTACT_SUPPORT', function contactSupportAction() {
      const failedSteps: ParsedJobStep[] = [
        { label: 'builder_domain_job_configuring_dns', status: 'FAILED' },
      ];
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          steps={failedSteps}
          domainError={buildDomainError('CONTACT_SUPPORT')}
        />,
      );
      expect(screen.queryByText('Retry connection')).not.toBeInTheDocument();
      // t('builder_domain_button_disconnect', undefined, 'Disconnect and reconnect')
      expect(screen.queryByText('Disconnect and reconnect')).not.toBeInTheDocument();
      expect(screen.getByText('Contact support')).toBeInTheDocument();
    });

    it('shows disconnect button and contact support for default action', function defaultAction() {
      const failedSteps: ParsedJobStep[] = [
        { label: 'builder_domain_job_configuring_dns', status: 'FAILED' },
      ];
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          steps={failedSteps}
          domainError={buildDomainError('SELF_SERVICE')}
        />,
      );
      expect(screen.queryByText('Retry connection')).not.toBeInTheDocument();
      expect(screen.getByText('Disconnect and reconnect')).toBeInTheDocument();
      expect(screen.getByText('Contact support')).toBeInTheDocument();
    });

    it('shows fallback error block when error exists but no step has FAILED status', function fallbackErrorBlock() {
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          appDomainStatus="failed"
          steps={[{ label: 'builder_domain_job_configuring_dns', status: null }]}
          domainError={buildDomainError('CONTACT_SUPPORT')}
        />,
      );
      expect(screen.getByText('Contact support')).toBeInTheDocument();
    });
  });

  describe('loading state', function loadingStateSuite() {
    it('shows skeleton rows on initial load (isRefreshing=true, no steps yet)', function skeletonOnInitialLoad() {
      renderWithProviders(
        <DomainConnectionStatusStepper {...defaultProps} steps={[]} isRefreshing={true} />,
      );
      const skeletons = screen.getAllByTestId('skeleton');
      // 3 step rows × 3 skeletons each (icon circle + label bar + subtitle bar), mirroring a real step
      expect(skeletons.length).toBe(9);
      expect(screen.queryByText('builder_domain_job_starting_connection')).not.toBeInTheDocument();
    });

    it('does not show skeleton when steps are already present during re-fetch', function noSkeletonWithData() {
      renderWithProviders(
        <DomainConnectionStatusStepper {...defaultProps} isRefreshing={true} />,
      );
      expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('builder_domain_job_starting_connection')).toBeInTheDocument();
    });

  });

  describe('CTA interactions', function ctaInteractionSuite() {
    it('calls onRefresh and fires click event when "Retry connection" is clicked (inline FAILED step)', function retryInlineClick() {
      const failedSteps: ParsedJobStep[] = [
        { label: 'builder_domain_job_configuring_dns', status: 'FAILED' },
      ];
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          steps={failedSteps}
          domainError={buildDomainError('RETRY')}
        />,
      );
      fireEvent.click(screen.getByText('Retry connection'));
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('settings.domains.status_view_retry');
    });

    it('calls onDisconnect and fires click event when "Disconnect and reconnect" is clicked (inline FAILED step)', function disconnectInlineClick() {
      const failedSteps: ParsedJobStep[] = [
        { label: 'builder_domain_job_configuring_dns', status: 'FAILED' },
      ];
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          steps={failedSteps}
          domainError={buildDomainError('SELF_SERVICE')}
        />,
      );
      fireEvent.click(screen.getByText('Disconnect and reconnect'));
      expect(defaultProps.onDisconnect).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('settings.domains.status_view_disconnect');
    });

    it('calls onRefresh and fires click event when "Retry connection" is clicked (fallback error block)', function retryFallbackClick() {
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          appDomainStatus="failed"
          steps={[{ label: 'builder_domain_job_configuring_dns', status: null }]}
          domainError={buildDomainError('RETRY')}
        />,
      );
      fireEvent.click(screen.getByText('Retry connection'));
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('settings.domains.status_view_retry');
    });

    it('calls onDisconnect and fires click event when "Disconnect and reconnect" is clicked (fallback error block)', function disconnectFallbackClick() {
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          appDomainStatus="failed"
          steps={[{ label: 'builder_domain_job_configuring_dns', status: null }]}
          domainError={buildDomainError('SELF_SERVICE')}
        />,
      );
      fireEvent.click(screen.getByText('Disconnect and reconnect'));
      expect(defaultProps.onDisconnect).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('settings.domains.status_view_disconnect');
    });
  });

  describe('instrumentation', function instrumentationSuite() {
    it('fires status_view_shown impression on mount', async function impressionOnMount() {
      renderWithProviders(<DomainConnectionStatusStepper {...defaultProps} />);
      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.status_view_shown');
      });
    });

    it('fires status_view_shown impression exactly once on re-render', async function impressionOnce() {
      const { rerender } = renderWithProviders(
        <DomainConnectionStatusStepper {...defaultProps} />,
      );
      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.status_view_shown');
      });
      rerender(<DomainConnectionStatusStepper {...defaultProps} overallStatus="RUNNING" />);
      const shownCalls = vi.mocked(logImpressionEvent).mock.calls.filter(
        ([eid]) => eid === 'settings.domains.status_view_shown',
      );
      expect(shownCalls).toHaveLength(1);
    });

    it('fires status_view_error_shown when error state is visible', async function errorImpression() {
      const failedSteps: ParsedJobStep[] = [
        { label: 'builder_domain_job_configuring_dns', status: 'FAILED' },
      ];
      renderWithProviders(
        <DomainConnectionStatusStepper
          {...defaultProps}
          overallStatus="FAILED"
          steps={failedSteps}
          domainError={buildDomainError('RETRY')}
        />,
      );
      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith(
          'settings.domains.status_view_error_shown',
          expect.objectContaining({ errorCode: 'TEST_ERROR_CODE', action: 'RETRY' }),
        );
      });
    });
  });
});
