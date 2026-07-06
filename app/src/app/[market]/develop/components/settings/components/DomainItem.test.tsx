/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import DomainItem from '@/app/[market]/develop/components/settings/components/DomainItem';
import { finishDomainJourney, trackDomainConnectStep } from '@/hooks/shared/domainJourneyFunnel';
import type { AppDomain } from '@/hooks/useAppDetails';
import type { Domain } from '@/hooks/useDomainsQuery';
import { DomainMutationError } from '@/hooks/useModifyDomains';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { DomainStatus } from '@/lib/control-plane/types';
import type { AiroDomainErrorResponse } from '@/lib/mgmt-airo';
import { CdnStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { renderWithProviders } from '@/tests/test-utils';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

const SUPPORT_URL = 'https://support.test/contact';
const { mockUseDomainJobPolling, mockUseDomainConflictCheck, mockCaaMutate, mockCaaReset, mockCaaError } = vi.hoisted(() => ({
  mockUseDomainJobPolling: vi.fn(),
  mockUseDomainConflictCheck: vi.fn().mockReturnValue({ hasDnsDrift: false }),
  mockCaaMutate: vi.fn(),
  mockCaaReset: vi.fn(),
  mockCaaError: { value: null as Error | null },
}));

vi.mock('@/hooks/useGasketConfig', () => ({
  useGasketConfig: () => ({
    config: { supportUrl: SUPPORT_URL },
    isLoading: false,
    error: null,
    isRuntimeConfig: false,
  }),
}));

vi.mock('@/hooks/useDomainJobPolling', () => ({
  domainJobQueryKey: (siteId: string, fqdn: string) =>
    ['domain-job', siteId, fqdn.trim().toLowerCase()] as const,
  useDomainJobPolling: (...args: unknown[]) => mockUseDomainJobPolling(...args),
}));

// Funnel is exercised in its own test; stub it here so DomainItem's terminal/
// sub-step effects don't invoke real analytics plumbing.
vi.mock('@/hooks/shared/domainJourneyFunnel', () => ({
  startDomainJourney: vi.fn(),
  getDomainJourneyId: vi.fn(),
  trackDomainMilestone: vi.fn(),
  trackDomainConnectStep: vi.fn(),
  finishDomainJourney: vi.fn(),
  resetDomainJourneyFunnel: vi.fn(),
}));

const mockFinishDomainJourney = vi.mocked(finishDomainJourney);
const mockTrackDomainConnectStep = vi.mocked(trackDomainConnectStep);

vi.mock('@/hooks/useDomainConflictCheck', () => ({
  useDomainConflictCheck: (...args: unknown[]) => mockUseDomainConflictCheck(...args),
}));
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => true),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id: string) => `${id}.click`),
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/domain-validation', () => ({
  translateDomainApiError: vi.fn((_code: string, _t: unknown, fallback?: string) => fallback ?? 'Translated error'),
  CAA_REMEDIATION_NOT_GD_MANAGED: 'DOMAIN_NOT_GD_MANAGED',
  caaVariantForCode: (code?: string) =>
    code === 'CLOUDFLARE_CAA_INTERNAL_MISMATCH'
      ? 'consent'
      : code === 'CLOUDFLARE_CAA_MISMATCH'
        ? 'selfService'
        : null,
}));

vi.mock('@/hooks/useCaaRemediation', () => ({
  useCaaRemediation: () => ({
    mutate: mockCaaMutate,
    reset: mockCaaReset,
    isPending: false,
    error: mockCaaError.value,
  }),
}));

vi.mock('@/app/[market]/develop/components/settings/components/DomainConnectionStatusStepper', () => ({
  default: () => <div data-testid="connection-status-stepper" />,
}));

const baseDomain: Domain = {
  domain: 'example.com',
};

const defaultProps = {
  domain: baseDomain,
  siteId: 'site-123',
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
};

function buildErrorResponse(action: 'RETRY' | 'SELF_SERVICE' | 'CONTACT_SUPPORT'): AiroDomainErrorResponse {
  return {
    appId: 'app-1',
    fqdn: 'example.com',
    jobId: 'job-1',
    status: 'failed',
    error: {
      code: 'SOME_ERROR',
      message: 'Something went wrong',
      action,
      canRetry: action === 'RETRY',
    },
    affectedDomains: ['example.com'],
    failedStep: 'cdn_provision',
    completedAt: '2025-01-01T00:00:00Z',
  };
}

function mockFetchDomainError(errorResponse: AiroDomainErrorResponse) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => errorResponse,
  } as Response);
}

describe('DomainItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(useSwitchboard).mockReturnValue(true);
    mockUseDomainJobPolling.mockReturnValue({
      labelKey: null,
      status: null,
      overallStatus: null,
      steps: [],
      isLoading: false,
      isFetching: false,
      error: null,
    });
    mockUseDomainConflictCheck.mockReturnValue({ hasDnsDrift: false });
    vi.mocked(useSwitchboard).mockReturnValue(true);
    mockCaaError.value = null;
    useDevelopPageStore.setState({ domainJobsInProgress: {} });
  });

  describe('error action rendering', () => {
    beforeEach(() => {
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => flag !== 'appbuilder-domain-connection-status-view');
    });
    const errorAppDomain: AppDomain = {
      fqdn: 'example.com',
      isPrimary: true,
      status: DomainStatus.FAILED,
    };

    it('should show only contact support when action is CONTACT_SUPPORT', async () => {
      mockFetchDomainError(buildErrorResponse('CONTACT_SUPPORT'));

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={errorAppDomain} />
      );

      await waitFor(() => {
        expect(screen.getByText('builder_common_contact_support')).toBeInTheDocument();
      });

      expect(screen.queryByText(/builder_domain_error_please_retry/)).not.toBeInTheDocument();
      expect(screen.queryByText(/builder_domain_disconnect_and_reconnect/)).not.toBeInTheDocument();
    });

    it('should show retry message and contact support when action is RETRY', async () => {
      mockFetchDomainError(buildErrorResponse('RETRY'));

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={errorAppDomain} />
      );

      await waitFor(() => {
        expect(screen.getByText(/builder_domain_error_please_retry/)).toBeInTheDocument();
      });

      expect(screen.getByText(/builder_domain_error_if_issue_persists/)).toBeInTheDocument();
      expect(screen.getByText('builder_common_contact_support')).toBeInTheDocument();
      expect(screen.queryByText(/builder_domain_disconnect_and_reconnect/)).not.toBeInTheDocument();
    });

    it('should show disconnect and reconnect when action is SELF_SERVICE', async () => {
      mockFetchDomainError(buildErrorResponse('SELF_SERVICE'));

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={errorAppDomain} />
      );

      await waitFor(() => {
        expect(screen.getByText(/builder_domain_disconnect_and_reconnect/)).toBeInTheDocument();
      });

      expect(screen.getByText('builder_common_contact_support')).toBeInTheDocument();
      expect(screen.queryByText(/builder_domain_error_please_retry/)).not.toBeInTheDocument();
    });

    it('should render contact support as a link to support URL', async () => {
      mockFetchDomainError(buildErrorResponse('CONTACT_SUPPORT'));

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={errorAppDomain} />
      );

      await waitFor(() => {
        expect(screen.getByText('builder_common_contact_support')).toBeInTheDocument();
      });

      const supportLink = screen.getByText('builder_common_contact_support').closest('a');
      expect(supportLink).toHaveAttribute('href', SUPPORT_URL);
    });

    it('should not show error section when domain has no error status', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

      const activeDomain: AppDomain = {
        fqdn: 'example.com',
        isPrimary: true,
        status: DomainStatus.ACTIVE,
      };

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={activeDomain} />
      );

      expect(screen.queryByText('builder_common_contact_support')).not.toBeInTheDocument();
      expect(screen.queryByText(/builder_domain_error_please_retry/)).not.toBeInTheDocument();
      expect(screen.queryByText(/builder_domain_disconnect_and_reconnect/)).not.toBeInTheDocument();
    });

    it('should also trigger error fetch when cdnStatus is ERROR', async () => {
      mockFetchDomainError(buildErrorResponse('RETRY'));

      const cdnErrorDomain: AppDomain = {
        fqdn: 'example.com',
        isPrimary: true,
        status: DomainStatus.ACTIVE,
        cdnStatus: CdnStatus.ERROR,
      };

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={cdnErrorDomain} />
      );

      await waitFor(() => {
        expect(screen.getByText(/builder_domain_error_please_retry/)).toBeInTheDocument();
      });
    });
  });

  describe('CAA remediation', () => {
    const errorAppDomain: AppDomain = {
      fqdn: 'example.com',
      isPrimary: true,
      status: DomainStatus.FAILED,
    };

    function buildCaaErrorResponse(code: string): AiroDomainErrorResponse {
      return {
        appId: 'app-1',
        fqdn: 'example.com',
        jobId: 'job-1',
        status: 'failed',
        error: { code, message: 'CAA mismatch', action: 'SELF_SERVICE', canRetry: false },
        affectedDomains: ['example.com'],
        failedStep: 'cert_issue',
        completedAt: '2025-01-01T00:00:00Z',
      };
    }

    it('shows the inline consent banner (not the generic error) for an internal CAA mismatch', async () => {
      mockFetchDomainError(buildCaaErrorResponse('CLOUDFLARE_CAA_INTERNAL_MISMATCH'));

      renderWithProviders(<DomainItem {...defaultProps} appDomain={errorAppDomain} />);

      await waitFor(() => {
        expect(screen.getByText(/Action required to connect your app to example.com/)).toBeInTheDocument();
      });
      expect(screen.getByText('Would you like us to remove them?')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
      expect(screen.queryByText('builder_common_contact_support')).not.toBeInTheDocument();
    });

    it('falls back to self-service instructions when remediation returns DOMAIN_NOT_GD_MANAGED', async () => {
      mockCaaError.value = new DomainMutationError({
        code: 'CAA_REMEDIATION_FAILED',
        message: 'CAA remediation is only available for GoDaddy-managed domains',
        nestedCode: 'DOMAIN_NOT_GD_MANAGED',
      });
      mockFetchDomainError(buildCaaErrorResponse('CLOUDFLARE_CAA_INTERNAL_MISMATCH'));

      renderWithProviders(<DomainItem {...defaultProps} appDomain={errorAppDomain} />);

      // Self-service instructions render instead of the consent prompt or raw error
      await waitFor(() => {
        expect(screen.getByText('How to fix this:')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      expect(screen.queryByText(/DOMAIN_NOT_GD_MANAGED/)).not.toBeInTheDocument();
    });

    it('fires caa_banner_shown once per domain + variant', async () => {
      mockFetchDomainError(buildCaaErrorResponse('CLOUDFLARE_CAA_INTERNAL_MISMATCH'));

      const { rerender } = renderWithProviders(
        <DomainItem {...defaultProps} appDomain={errorAppDomain} />,
      );

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.caa_banner_shown', {
          variant: 'consent',
        });
      });

      // Re-render with identical inputs — the ref guard must prevent a duplicate fire
      rerender(<DomainItem {...defaultProps} appDomain={errorAppDomain} />);

      await waitFor(() => {
        const bannerCalls = vi.mocked(logImpressionEvent).mock.calls.filter(
          ([eid]) => eid === 'settings.domains.caa_banner_shown',
        );
        expect(bannerCalls).toHaveLength(1);
      });
    });

    it('calls remediation when the inline Approve button is clicked', async () => {
      mockFetchDomainError(buildCaaErrorResponse('CLOUDFLARE_CAA_INTERNAL_MISMATCH'));

      renderWithProviders(<DomainItem {...defaultProps} appDomain={errorAppDomain} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

      expect(mockCaaMutate).toHaveBeenCalledWith({
        siteId: 'site-123',
        payload: {
          domainsToCreate: [{ fqdn: 'example.com', primary: false }],
          createCdn: true,
          consent: true,
        },
      });
    });

    it('disconnects the domain when Reject is clicked', async () => {
      const onDisconnect = vi.fn();
      mockFetchDomainError(buildCaaErrorResponse('CLOUDFLARE_CAA_INTERNAL_MISMATCH'));

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={errorAppDomain} onDisconnect={onDisconnect} />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

      expect(onDisconnect).toHaveBeenCalledWith('example.com');
    });

    it('shows the inline self-service banner for an external CAA mismatch and retries via onConnect', async () => {
      const onConnect = vi.fn();
      mockFetchDomainError(buildCaaErrorResponse('CLOUDFLARE_CAA_MISMATCH'));

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={errorAppDomain} onConnect={onConnect} />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
      });
      expect(screen.getByText('How to fix this:')).toBeInTheDocument();
      expect(screen.getByText("Log in to your domain's DNS provider.")).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));

      expect(onConnect).toHaveBeenCalledWith('example.com');
    });

    it('hides the CAA banner and shows the generic error when the flag is off', async () => {
      // Both the CAA and connection-status-view features gate the generic error block;
      // disable both so the legacy generic error renders (either flag on would own the error).
      vi.mocked(useSwitchboard).mockImplementation(
        (flag: string) =>
          flag !== 'appbuilder-domain-caa-remediation' &&
          flag !== 'appbuilder-domain-connection-status-view',
      );
      mockFetchDomainError(buildCaaErrorResponse('CLOUDFLARE_CAA_INTERNAL_MISMATCH'));

      renderWithProviders(<DomainItem {...defaultProps} appDomain={errorAppDomain} />);

      await waitFor(() => {
        expect(screen.getByText(/builder_domain_disconnect_and_reconnect/)).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      expect(screen.queryByText('Would you like us to remove them?')).not.toBeInTheDocument();
    });
  });

  describe('CSP instrumentation', () => {
    const failedAppDomain: AppDomain = {
      fqdn: 'example.com',
      isPrimary: true,
      status: DomainStatus.FAILED,
    };

    it('fires item_error_shown with errorCode + action and item_status_failed for a FAILED domain', async () => {
      mockFetchDomainError(buildErrorResponse('CONTACT_SUPPORT'));

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={failedAppDomain} />
      );

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.item_error_shown', {
          errorCode: 'SOME_ERROR',
          action: 'CONTACT_SUPPORT',
        });
      });
      expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.item_status_failed');
    });

    it('fires item_status_active for an ACTIVE domain', async () => {
      const activeAppDomain: AppDomain = {
        fqdn: 'example.com',
        isPrimary: true,
        status: DomainStatus.ACTIVE,
      };

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={activeAppDomain} />
      );

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.item_status_active');
      });
    });

    it('fires item_status_active exactly once across re-renders with unchanged status', async () => {
      const activeAppDomain: AppDomain = {
        fqdn: 'example.com',
        isPrimary: true,
        status: DomainStatus.ACTIVE,
      };

      const { rerender } = renderWithProviders(
        <DomainItem {...defaultProps} appDomain={activeAppDomain} />
      );

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.item_status_active');
      });

      // Re-render with identical inputs — the ref guard must prevent a duplicate fire
      rerender(<DomainItem {...defaultProps} appDomain={activeAppDomain} />);

      await waitFor(() => {
        const statusCalls = vi.mocked(logImpressionEvent).mock.calls.filter(
          ([eid]) => eid === 'settings.domains.item_status_active',
        );
        expect(statusCalls).toHaveLength(1);
      });
    });

    it('re-fires item_status when the domain key changes', async () => {
      const { rerender } = renderWithProviders(
        <DomainItem
          domain={{ domain: 'first.com' }}
          siteId="site-123"
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          appDomain={{ fqdn: 'first.com', isPrimary: true, status: DomainStatus.ACTIVE }}
        />
      );

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.item_status_active');
      });

      // Switch to a different domain — new key re-arms the guard and fires again
      rerender(
        <DomainItem
          domain={{ domain: 'second.com' }}
          siteId="site-123"
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          appDomain={{ fqdn: 'second.com', isPrimary: true, status: DomainStatus.ACTIVE }}
        />
      );

      await waitFor(() => {
        const statusCalls = vi.mocked(logImpressionEvent).mock.calls.filter(
          ([eid]) => eid === 'settings.domains.item_status_active',
        );
        expect(statusCalls).toHaveLength(2);
      });
    });
  });

  describe('options menu', function optionsMenuTests() {
    beforeEach(function mockResizeObserver() {
      global.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as typeof ResizeObserver;
    });

    it('shows disconnect in menu for connected domain with radioMode', function disconnectWithRadioMode() {
      const onDisconnect = vi.fn();
      const activeDomain: AppDomain = {
        fqdn: 'example.com',
        isPrimary: false,
        status: DomainStatus.ACTIVE,
      };

      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={activeDomain}
          onDisconnect={onDisconnect}
          radioMode
          isSelected={false}
          onSelect={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Options' }));

      const disconnectButton = screen.getByRole('button', { name: 'builder_domain_button_disconnect' });
      expect(disconnectButton).toBeInTheDocument();
      fireEvent.click(disconnectButton);
      expect(onDisconnect).toHaveBeenCalledWith('example.com');
    });

    it('hides connect in menu for available domain with radioMode', function noConnectWithRadioMode() {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={undefined}
          radioMode
          isSelected={false}
          onSelect={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Options' }));

      expect(screen.queryByRole('button', { name: 'builder_domain_button_connect' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'builder_domain_button_disconnect' })).not.toBeInTheDocument();
    });
  });

  describe('job polling recovery', () => {
    const pendingDomain: AppDomain = {
      fqdn: 'example.com',
      isPrimary: true,
      status: DomainStatus.PENDING,
    };

    it('should enable polling for pending custom domain without in-progress store job', () => {
      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      expect(mockUseDomainJobPolling).toHaveBeenCalledWith('site-123', 'example.com', true, expect.any(Function));
    });

    it('should enable polling when custom domain status is undefined', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: undefined }}
          isCustomDomain
        />
      );

      expect(mockUseDomainJobPolling).toHaveBeenCalledWith('site-123', 'example.com', true, expect.any(Function));
    });

    it('should render polled verifying label while job is running', () => {
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: 'builder_domain_job_verifying_domain',
        status: 'RUNNING',
        overallStatus: 'RUNNING',
        steps: [],
        isLoading: false,
        isFetching: false,
        error: null,
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      expect(screen.getByText(function verifyingMatcher(content) {
        return content === 'Verifying domain...' || content === 'builder_domain_job_verifying_domain';
      })).toBeInTheDocument();
    });

    it('should fall back to pending label and clear stale in-progress job on NOT_FOUND', async () => {
      useDevelopPageStore.setState({
        domainJobsInProgress: {
          'site-123': {
            fqdn: 'example.com',
            startedAt: Date.now(),
            jobStatus: 'RUNNING',
          },
        },
      });
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: null,
        status: null,
        overallStatus: 'NOT_FOUND',
        steps: [],
        isLoading: false,
        isFetching: false,
        error: null,
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      expect(screen.getByText('builder_domain_status_pending')).toBeInTheDocument();
      await waitFor(function storeCleared() {
        expect(useDevelopPageStore.getState().domainJobsInProgress['site-123']).toBeUndefined();
      });
      expect(mockFinishDomainJourney).toHaveBeenCalledWith(
        'connect_failed',
        'failure',
        expect.objectContaining({ appId: 'site-123', fqdn: 'example.com', errorType: 'NOT_FOUND' })
      );
    });

    it('should clear stale in-progress job when job polling errors', async () => {
      useDevelopPageStore.setState({
        domainJobsInProgress: {
          'site-123': {
            fqdn: 'example.com',
            startedAt: Date.now(),
            jobStatus: 'RUNNING',
          },
        },
      });
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: null,
        status: null,
        overallStatus: null,
        steps: [],
        isLoading: false,
        isFetching: false,
        error: new Error('network failed'),
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      await waitFor(function clearsOnPollError() {
        expect(useDevelopPageStore.getState().domainJobsInProgress['site-123']).toBeUndefined();
      });
      expect(logger.error).toHaveBeenCalledWith('domain-item.poll.error', {
        siteId: 'site-123',
        fqdn: 'example.com',
        error: 'network failed',
      });
      expect(mockFinishDomainJourney).toHaveBeenCalledWith(
        'connect_failed',
        'failure',
        expect.objectContaining({ appId: 'site-123', fqdn: 'example.com', errorType: 'poll_error' })
      );
    });

    it('should log polling errors even without an in-progress store job', async () => {
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: null,
        status: null,
        overallStatus: null,
        steps: [],
        isLoading: false,
        isFetching: false,
        error: new Error('site not found'),
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      await waitFor(function logsPollError() {
        expect(logger.error).toHaveBeenCalledWith('domain-item.poll.error', {
          siteId: 'site-123',
          fqdn: 'example.com',
          error: 'site not found',
        });
      });
      expect(useDevelopPageStore.getState().domainJobsInProgress['site-123']).toBeUndefined();
    });

    it('should fall back to pending label when polled status is SUCCESS', () => {
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: 'builder_domain_job_verifying_domain',
        status: 'SUCCESS',
        overallStatus: 'SUCCESS',
        steps: [],
        isLoading: false,
        isFetching: false,
        error: null,
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      expect(screen.getByText('builder_domain_status_pending')).toBeInTheDocument();
      expect(screen.queryByText('Verifying domain...')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_domain_job_verifying_domain')).not.toBeInTheDocument();
      // No store job → activeJobForDomain is null → terminal effect exits early
      expect(mockFinishDomainJourney).not.toHaveBeenCalled();
    });

    it('should emit connect_completed when SUCCESS polled and store job is set', async () => {
      useDevelopPageStore.setState({
        domainJobsInProgress: {
          'site-123': {
            fqdn: 'example.com',
            startedAt: Date.now(),
            jobStatus: 'RUNNING',
          },
        },
      });
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: 'builder_domain_job_verifying_domain',
        status: 'SUCCESS',
        overallStatus: 'SUCCESS',
        isLoading: false,
        error: null,
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      await waitFor(function connectCompleted() {
        expect(mockFinishDomainJourney).toHaveBeenCalledWith(
          'connect_completed',
          'success',
          { appId: 'site-123', fqdn: 'example.com' }
        );
      });
    });

    it('should emit connect_step only once per distinct labelKey', async () => {
      useDevelopPageStore.setState({
        domainJobsInProgress: {
          'site-123': {
            fqdn: 'example.com',
            startedAt: Date.now(),
            jobStatus: 'RUNNING',
          },
        },
      });
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: 'builder_domain_job_verifying_domain',
        status: 'RUNNING',
        overallStatus: 'RUNNING',
        isLoading: false,
        error: null,
      });

      const { rerender } = renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      await waitFor(function stepEmitted() {
        expect(mockTrackDomainConnectStep).toHaveBeenCalledWith(
          'builder_domain_job_verifying_domain',
          { appId: 'site-123', fqdn: 'example.com' }
        );
      });

      rerender(<DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />);
      await act(async () => { await Promise.resolve(); });

      expect(mockTrackDomainConnectStep).toHaveBeenCalledTimes(1);
    });

    it('should emit connect_failed timeout when poll timeout callback fires', async () => {
      let capturedOnPollTimeout: ((elapsedMs: number) => void) | undefined;

      mockUseDomainJobPolling.mockImplementation(
        function (_siteId: unknown, _fqdn: unknown, _shouldPoll: unknown, onPollTimeout: unknown) {
          capturedOnPollTimeout = onPollTimeout as (elapsedMs: number) => void;
          return {
            labelKey: 'builder_domain_job_verifying_domain',
            status: 'RUNNING',
            overallStatus: 'RUNNING',
            isLoading: false,
            error: null,
          };
        }
      );

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      expect(capturedOnPollTimeout).toBeTypeOf('function');
      act(() => { capturedOnPollTimeout!(30000); });

      expect(mockFinishDomainJourney).toHaveBeenCalledWith(
        'connect_failed',
        'timeout',
        { appId: 'site-123', fqdn: 'example.com', errorType: 'poll_timeout', elapsedMs: 30000 }
      );
    });

    it('should not render stale polled label when polling is disabled and domain is disconnected', () => {
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: 'builder_domain_job_verifying_domain',
        status: 'RUNNING',
        overallStatus: 'RUNNING',
        steps: [],
        isLoading: false,
        isFetching: false,
        error: null,
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={undefined} isCustomDomain />
      );

      expect(screen.queryByText('Verifying domain...')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_domain_job_verifying_domain')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_domain_status_not_connected')).not.toBeInTheDocument();
    });

    it('should enable polling for FAILED custom domain when connection status view flag is on', function failedPollingEnabled() {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.FAILED }}
          isCustomDomain
        />
      );
      expect(mockUseDomainJobPolling).toHaveBeenCalledWith('site-123', 'example.com', true, expect.any(Function));
    });

    it('should enable polling for ERROR custom domain when connection status view flag is on', function errorPollingEnabled() {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.ERROR }}
          isCustomDomain
        />
      );
      expect(mockUseDomainJobPolling).toHaveBeenCalledWith('site-123', 'example.com', true, expect.any(Function));
    });
  });

  describe('connection status stepper gate', () => {
    // Copy lives only in i18n now (no defaultMessage): with the empty test catalog, react-intl
    // renders each key as its id, so the accessible name is the key.
    const TOGGLE_LABEL = 'builder_domain_status_view_toggle_details';
    const CHECK_STATUS_LABEL = 'builder_domain_status_view_check_status';

    it('shows the stepper and chevron toggle for a PENDING domain when the flag is on', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.PENDING }}
        />,
      );
      expect(screen.getByTestId('connection-status-stepper')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: TOGGLE_LABEL })).toBeInTheDocument();
    });

    it('shows the Check connection status button in the header for a connecting domain', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.PENDING }}
        />,
      );
      expect(screen.getByRole('button', { name: CHECK_STATUS_LABEL })).toBeInTheDocument();
    });

    it('fires the check_status_button click event when the header button is clicked', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.PENDING }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: CHECK_STATUS_LABEL }));
      expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('settings.domains.check_status_button');
    });

    it('does not show the Check connection status button for an ACTIVE domain with no job', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.ACTIVE }}
        />,
      );
      expect(screen.queryByRole('button', { name: CHECK_STATUS_LABEL })).not.toBeInTheDocument();
    });

    it('collapses the stepper when the chevron toggle is clicked', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.PENDING }}
        />,
      );
      const toggle = screen.getByRole('button', { name: TOGGLE_LABEL });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('connection-status-stepper')).not.toBeInTheDocument();
    });

    it('does not show the stepper for an ACTIVE domain with no active job', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.ACTIVE }}
        />,
      );
      expect(screen.queryByTestId('connection-status-stepper')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: TOGGLE_LABEL })).not.toBeInTheDocument();
    });

    it('does not show the stepper when the flag is off, even for a PENDING domain', () => {
      vi.mocked(useSwitchboard).mockImplementation(
        (flag: string) => flag !== 'appbuilder-domain-connection-status-view',
      );
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.PENDING }}
        />,
      );
      expect(screen.queryByTestId('connection-status-stepper')).not.toBeInTheDocument();
    });
  });

  describe('DNS drift warning tag', () => {
    const activeDomain: AppDomain = {
      fqdn: 'example.com',
      isPrimary: true,
      status: DomainStatus.ACTIVE,
      anycastIp: '1.2.3.4',
    };

    it('shows warning tag when hasDnsDrift is true', () => {
      mockUseDomainConflictCheck.mockReturnValue({ hasDnsDrift: true });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={activeDomain} />
      );

      // t() uses defaultMessage='DNS changed' when translations are empty in tests
      expect(screen.getByText('DNS changed')).toBeInTheDocument();
    });

    it('shows active tag when hasDnsDrift is false', () => {
      mockUseDomainConflictCheck.mockReturnValue({ hasDnsDrift: false });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={activeDomain} />
      );

      expect(screen.getByText('builder_domain_status_active')).toBeInTheDocument();
      expect(screen.queryByText('DNS changed')).not.toBeInTheDocument();
    });

    it('shows explanation message when hasDnsDrift is true', () => {
      mockUseDomainConflictCheck.mockReturnValue({ hasDnsDrift: true });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={activeDomain} />
      );

      expect(screen.getByText('Your DNS settings were changed. Reconnect if you want your app to work again with the domain.')).toBeInTheDocument();
    });

    it('does not show explanation message when hasDnsDrift is false', () => {
      mockUseDomainConflictCheck.mockReturnValue({ hasDnsDrift: false });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={activeDomain} />
      );

      expect(screen.queryByText('Your DNS settings were changed. Reconnect if you want your app to work again with the domain.')).not.toBeInTheDocument();
    });

    it('calls useDomainConflictCheck with enabled=true only for ACTIVE connected domain', () => {
      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={activeDomain} />
      );

      expect(mockUseDomainConflictCheck).toHaveBeenCalledWith(
        'site-123',
        'example.com',
        '1.2.3.4',
        true,
      );
    });

    it('calls useDomainConflictCheck with enabled=false for disconnected domain', () => {
      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={undefined} />
      );

      expect(mockUseDomainConflictCheck).toHaveBeenCalledWith(
        'site-123',
        'example.com',
        undefined,
        false,
      );
    });

    it('calls useDomainConflictCheck with enabled=false for PENDING domain', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: DomainStatus.PENDING }}
        />
      );

      expect(mockUseDomainConflictCheck).toHaveBeenCalledWith(
        'site-123',
        'example.com',
        undefined,
        false,
      );
    });
  });
});
