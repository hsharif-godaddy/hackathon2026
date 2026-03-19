import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import type { AppDomain } from '@/hooks/useAppDetails';
import { DomainStatus } from '@/lib/mgmt-airo/types';
import { renderWithProviders } from '@/tests/test-utils';
import DomainAttachWidget from './DomainAttachWidget';

// -- Hook mocks --

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true, isLoading: false })),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true, isLoading: false })),
}));

vi.mock('@/hooks/useAppDetails', () => ({
  useAppDetails: vi.fn(() => ({
    data: undefined,
    isFetched: true,
  })),
}));

vi.mock('@/hooks/useDomainsQuery', () => ({
  useDomainsQuery: vi.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
    isFetched: true,
  })),
}));

vi.mock('@/hooks/useCustomerDomainAttach', () => ({
  useCustomerDomainAttach: vi.fn(() => ({
    pendingCustomerDomain: null,
    isPolling: false,
    isAttaching: false,
    hasExternalNameservers: false,
    attachFailed: false,
    requiresManualDnsSetup: false,
  })),
}));

vi.mock('@/hooks/useDomainValidationQuery', () => ({
  useDomainValidationQuery: vi.fn(() => ({
    data: null,
    isLoading: false,
    isError: false,
  })),
}));

vi.mock('@/hooks/useModifyDomains', () => ({
  useModifyDomains: vi.fn(() => ({
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
    error: null,
    isError: false,
  })),
  DomainMutationError: class extends Error {},
}));

// -- Component utility mocks --

vi.mock('@/app/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: vi.fn(() => vi.fn()),
}));

vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-123'),
}));

// -- Store mocks --

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn((selector: any) => selector({
    getSite: () => ({
      id: 'test-app-123',
      subscription_id: 'sub-123',
      variants: ['publish'],
    }),
  })),
}));

// -- Utility / logging mocks --

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(() => true),
}));

vi.mock('@/utils/domain-validation', () => ({
  getDomainErrorMessage: vi.fn(() => undefined),
  translateDomainApiError: vi.fn(() => 'Translated error'),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id: string) => `${id}.click`),
}));

// DomainItem child dependency
vi.mock('@/hooks/useGasketConfig', () => ({
  useGasketConfig: () => ({
    config: { supportUrl: 'https://support.test' },
    isLoading: false,
    error: null,
    isRuntimeConfig: false,
  }),
}));

const pendingCustomerDomain: AppDomain = {
  fqdn: 'example.com',
  isPrimary: false,
  status: DomainStatus.PENDING,
  anycastIp: '1.2.3.4',
  certificateValidationCname: 'abc123.validation.secureserver.net',
};

describe('DomainAttachWidget', function domainAttachWidgetTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('pendingDomain with requiresManualDnsSetup', function manualDnsTests() {
    it('should render DNS instructions when requiresManualDnsSetup is true', async function renderDns() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain,
        isPolling: true,
        isAttaching: false,
        hasExternalNameservers: true,
        attachFailed: false,
        requiresManualDnsSetup: true,
      });

      vi.mocked(useAppDetails).mockReturnValue({
        data: {
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [pendingCustomerDomain],
        },
        isFetched: true,
      } as any);

      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      await waitFor(function waitForDns() {
        expect(screen.getByText('builder_domain_attach_dns_title')).toBeInTheDocument();
      });

      expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
    });

    it('should render DNS instructions when attach API failed', async function renderDnsOnFail() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain,
        isPolling: true,
        isAttaching: false,
        hasExternalNameservers: false,
        attachFailed: true,
        requiresManualDnsSetup: true,
      });

      vi.mocked(useAppDetails).mockReturnValue({
        data: {
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [pendingCustomerDomain],
        },
        isFetched: true,
      } as any);

      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      await waitFor(function waitForDns() {
        expect(screen.getByText('builder_domain_attach_dns_title')).toBeInTheDocument();
      });
    });

    it('should not render DNS instructions when requiresManualDnsSetup is false and domain is active', async function noDns() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain: null,
        isPolling: false,
        isAttaching: false,
        hasExternalNameservers: false,
        attachFailed: false,
        requiresManualDnsSetup: false,
      });

      vi.mocked(useAppDetails).mockReturnValue({
        data: {
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        },
        isFetched: true,
      } as any);

      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      await waitFor(function waitForNoTitle() {
        expect(screen.queryByText('builder_domain_attach_dns_title')).not.toBeInTheDocument();
      });
    });
  });

  describe('feature flag gating', function featureFlagTests() {
    it('should return null when domain attach feature flag is disabled', async function disabled() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useSwitchboard).mockImplementation((feature: string) => {
        if (feature === 'appbuilder-domain-attach') {
          return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { container } = renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      expect(container.innerHTML).toBe('');
    });

    it('should return null while feature flag is loading', async function loading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useSwitchboard).mockImplementation((feature: string) => {
        if (feature === 'appbuilder-domain-attach') {
          return { data: undefined, isLoading: true } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { container } = renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      expect(container.innerHTML).toBe('');
    });
  });
});
