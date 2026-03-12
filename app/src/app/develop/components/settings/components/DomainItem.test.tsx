import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import DomainItem from '@/app/develop/components/settings/components/DomainItem';
import type { AppDomain } from '@/hooks/useAppDetails';
import type { Domain } from '@/hooks/useDomainsQuery';
import { DomainStatus } from '@/lib/control-plane/types';
import type { AiroDomainErrorResponse } from '@/lib/mgmt-airo';
import { CdnStatus } from '@/lib/mgmt-airo/types';
import { renderWithProviders } from '@/tests/test-utils';

const SUPPORT_URL = 'https://support.test/contact';

vi.mock('@/hooks/useGasketConfig', () => ({
  useGasketConfig: () => ({
    config: { supportUrl: SUPPORT_URL },
    isLoading: false,
    error: null,
    isRuntimeConfig: false,
  }),
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
});
