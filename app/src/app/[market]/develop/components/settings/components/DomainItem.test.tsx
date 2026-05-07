/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import DomainItem from '@/app/[market]/develop/components/settings/components/DomainItem';
import type { AppDomain } from '@/hooks/useAppDetails';
import type { Domain } from '@/hooks/useDomainsQuery';
import { DomainStatus } from '@/lib/control-plane/types';
import type { AiroDomainErrorResponse } from '@/lib/mgmt-airo';
import { CdnStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { renderWithProviders } from '@/tests/test-utils';

const SUPPORT_URL = 'https://support.test/contact';
const { mockUseDomainJobPolling } = vi.hoisted(() => ({
  mockUseDomainJobPolling: vi.fn(),
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

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id: string) => `${id}.click`),
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
    mockUseDomainJobPolling.mockReturnValue({
      labelKey: null,
      status: null,
      overallStatus: null,
      isLoading: false,
      error: null,
    });
    useDevelopPageStore.setState({ domainJobsInProgress: {} });
  });

  describe('error action rendering', () => {
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

      expect(mockUseDomainJobPolling).toHaveBeenCalledWith('site-123', 'example.com', true);
    });

    it('should enable polling when custom domain status is undefined', () => {
      renderWithProviders(
        <DomainItem
          {...defaultProps}
          appDomain={{ fqdn: 'example.com', isPrimary: true, status: undefined }}
          isCustomDomain
        />
      );

      expect(mockUseDomainJobPolling).toHaveBeenCalledWith('site-123', 'example.com', true);
    });

    it('should render polled verifying label while job is running', () => {
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: 'builder_domain_job_verifying_domain',
        status: 'RUNNING',
        overallStatus: 'RUNNING',
        isLoading: false,
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
        isLoading: false,
        error: null,
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      expect(screen.getByText('builder_domain_status_pending')).toBeInTheDocument();
      await waitFor(function storeCleared() {
        expect(useDevelopPageStore.getState().domainJobsInProgress['site-123']).toBeUndefined();
      });
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
        isLoading: false,
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
    });

    it('should log polling errors even without an in-progress store job', async () => {
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: null,
        status: null,
        overallStatus: null,
        isLoading: false,
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
        isLoading: false,
        error: null,
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={pendingDomain} isCustomDomain />
      );

      expect(screen.getByText('builder_domain_status_pending')).toBeInTheDocument();
      expect(screen.queryByText('Verifying domain...')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_domain_job_verifying_domain')).not.toBeInTheDocument();
    });

    it('should not render stale polled label when polling is disabled and domain is disconnected', () => {
      mockUseDomainJobPolling.mockReturnValue({
        labelKey: 'builder_domain_job_verifying_domain',
        status: 'RUNNING',
        overallStatus: 'RUNNING',
        isLoading: false,
        error: null,
      });

      renderWithProviders(
        <DomainItem {...defaultProps} appDomain={undefined} isCustomDomain />
      );

      expect(screen.queryByText('Verifying domain...')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_domain_job_verifying_domain')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_domain_status_not_connected')).not.toBeInTheDocument();
    });
  });
});
