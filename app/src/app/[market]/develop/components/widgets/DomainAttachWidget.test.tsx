/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import type { AppDomain } from '@/hooks/useAppDetails';
import { DomainStatus } from '@/lib/mgmt-airo/types';
import { renderWithProviders } from '@/tests/test-utils';
import { logImpressionEvent } from '@/utils/instrumentation';
import DomainAttachWidget from './DomainAttachWidget';

vi.mock('@ux/modal', () => ({
  default: function Modal({ children }: { children: any }) {
    return <div>{children}</div>;
  },
}));

// -- Hook mocks --

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(function () { return { isAuthenticated: true, isLoading: false }; }),
}));

vi.mock('@/hooks/useAppDetails', () => ({
  useAppDetails: vi.fn(function () { return {
    data: undefined,
    isFetched: true,
  }; }),
}));

vi.mock('@/hooks/useDomainsQuery', () => ({
  useDomainsQuery: vi.fn(function () { return {
    data: [],
    isLoading: false,
    error: null,
    isFetched: true,
  }; }),
}));

vi.mock('@/hooks/useCustomerDomainAttach', () => ({
  useCustomerDomainAttach: vi.fn(function () { return {
    pendingCustomerDomain: null,
    isPolling: false,
    hasExternalNameservers: false,
    requiresManualDnsSetup: false,
  }; }),
}));

vi.mock('@/hooks/useDomainValidationQuery', () => ({
  useDomainValidationQuery: vi.fn(function () { return {
    data: null,
    isLoading: false,
    isError: false,
  }; }),
}));

vi.mock('@/hooks/useDomainDnsOwnership', () => ({
  useDomainDnsOwnership: vi.fn(function () { return {
    data: { isGdDomain: false },
    isPending: false,
    isLoading: false,
    isError: false,
  }; }),
}));

const { mockModifyDomainsMutation } = vi.hoisted(function hoisted() {
  return {
    mockModifyDomainsMutation: {
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
      isError: false,
    },
  };
});

vi.mock('@/hooks/useModifyDomains', () => ({
  useModifyDomains: vi.fn(function () { return mockModifyDomainsMutation; }),
  DomainMutationError: class extends Error {},
}));

// -- Component utility mocks --

vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: vi.fn(function () { return vi.fn(); }),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(function () { return 'test-app-123'; }),
}));

// -- Store mocks --

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn(function (selector: any) { return selector({
    getSite: () => ({
      id: 'test-app-123',
      subscription_id: 'sub-123',
      variants: ['publish'],
    }),
  }); }),
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
  hasBeenPublished: vi.fn(function () { return true; }),
}));

vi.mock('@/utils/domain-validation', () => ({
  getDomainErrorMessage: vi.fn(function () { return undefined; }),
  translateDomainApiError: vi.fn(function () { return 'Translated error'; }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id: string) { return `${id}.click`; }),
  logClickEvent: vi.fn(function () { return vi.fn(); }),
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
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
    mockModifyDomainsMutation.error = null;
    mockModifyDomainsMutation.isError = false;
    mockModifyDomainsMutation.mutateAsync = vi.fn();
    mockModifyDomainsMutation.mutate = vi.fn();
    mockModifyDomainsMutation.reset = vi.fn();
  });

  describe('pendingDomain with requiresManualDnsSetup', function manualDnsTests() {
    it('should render DNS instructions when requiresManualDnsSetup is true', async function renderDns() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain,
        isPolling: true,
        hasExternalNameservers: true,
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

    it('should not render DNS instructions when isGdDomain is true', async function hideDnsForGdDomain() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');
      const { useDomainDnsOwnership } = await import('@/hooks/useDomainDnsOwnership');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain,
        isPolling: true,
        hasExternalNameservers: true,
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

      vi.mocked(useDomainDnsOwnership).mockReturnValue({
        data: { isGdDomain: true },
        isPending: false,
        isLoading: false,
        isError: false,
      } as any);

      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      await waitFor(function waitForNoDnsTitle() {
        expect(screen.queryByText('builder_domain_attach_dns_title')).not.toBeInTheDocument();
      });
    });

    it('should not render DNS instructions when gd-domain data exists and refetch errors', async function hideDnsForStaleGdDataOnError() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');
      const { useDomainDnsOwnership } = await import('@/hooks/useDomainDnsOwnership');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain,
        isPolling: true,
        hasExternalNameservers: true,
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

      vi.mocked(useDomainDnsOwnership).mockReturnValue({
        data: { isGdDomain: true },
        isPending: false,
        isLoading: false,
        isError: true,
      } as any);

      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      await waitFor(function waitForNoDnsTitle() {
        expect(screen.queryByText('builder_domain_attach_dns_title')).not.toBeInTheDocument();
      });
    });

    it('renders DNS instructions when domain-dns-ownership errors', async function renderDnsOnOwnershipError() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');
      const { useDomainDnsOwnership } = await import('@/hooks/useDomainDnsOwnership');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain,
        isPolling: true,
        hasExternalNameservers: true,
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

      vi.mocked(useDomainDnsOwnership).mockReturnValue({
        data: undefined,
        isPending: false,
        isLoading: false,
        isError: true,
      } as any);

      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      await waitFor(function waitForDnsTitle() {
        expect(screen.getByText('builder_domain_attach_dns_title')).toBeInTheDocument();
      });
    });

    it('should not render DNS instructions when requiresManualDnsSetup is false and domain is active', async function noDns() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain: null,
        isPolling: false,
        hasExternalNameservers: false,
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

  describe('Case 1 brand match vs app domains', function caseOneTests() {
    it('should not show owned-domain confirmation when domain is already active on app', async function skipCase1() {
      const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');
      const { useAppDetails } = await import('@/hooks/useAppDetails');

      const activeOnApp: AppDomain = {
        fqdn: 'owned.com',
        isPrimary: false,
        status: DomainStatus.ACTIVE,
        domainType: 'custom',
      };

      vi.mocked(useDomainsQuery).mockReturnValue({
        data: [{ domain: 'owned.com', name: 'owned.com' }],
        isLoading: false,
        error: null,
        isFetched: true,
      } as any);

      vi.mocked(useAppDetails).mockReturnValue({
        data: {
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [activeOnApp],
        },
        isFetched: true,
      } as any);

      renderWithProviders(
        <DomainAttachWidget appId="test-app-123" brandName="owned.com" />
      );

      await waitFor(function waitForMainWidget() {
        expect(screen.queryByText('builder_domain_attach_confirm_title')).not.toBeInTheDocument();
      });

      expect(screen.getByText('builder_domain_attach_widget_description')).toBeInTheDocument();
      expect(
        screen.getByText(/detaches it from any other site that was using that domain/)
      ).toBeInTheDocument();
    });

    it('should hide external domain section when brand is a non-owned domain already active on app', async function skipCase3() {
      const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');
      const { useAppDetails } = await import('@/hooks/useAppDetails');

      const activeOnApp: AppDomain = {
        fqdn: 'external-only.com',
        isPrimary: false,
        status: DomainStatus.ACTIVE,
        domainType: 'custom',
      };

      vi.mocked(useDomainsQuery).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        isFetched: true,
      } as any);

      vi.mocked(useAppDetails).mockReturnValue({
        data: {
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [activeOnApp],
        },
        isFetched: true,
      } as any);

      renderWithProviders(
        <DomainAttachWidget appId="test-app-123" brandName="external-only.com" />
      );

      await waitFor(function waitForExternalSectionHidden() {
        expect(screen.queryByText('builder_domain_attach_external_title')).not.toBeInTheDocument();
        expect(document.getElementById('external-domain-input')).toBeNull();
      });

      expect(screen.getByText('builder_domain_attach_widget_description')).toBeInTheDocument();
      expect(
        screen.getByText(/detaches it from any other site that was using that domain/)
      ).toBeInTheDocument();
    });
  });

  describe('airoapp.ai domain blocking', function blockedDomainTests() {
    beforeEach(async function setup() {
      const { useAppDetails } = await import('@/hooks/useAppDetails');
      const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

      vi.mocked(useDomainsQuery).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        isFetched: true,
      } as any);

      vi.mocked(useAppDetails).mockReturnValue({
        data: {
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        },
        isFetched: true,
      } as any);
    });

    it('should show error immediately when typing a .airoapp.ai domain', async function blocksAiroappAi() {
      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      const input = document.getElementById('external-domain-input');
      expect(input).toBeTruthy();

      fireEvent.change(input!, { target: { value: 'someapp.airoapp.ai' } });

      await waitFor(function waitForError() {
        expect(screen.getByText('builder_domain_error_fqdn_invalid')).toBeInTheDocument();
      });
    });

    it('should show error immediately when typing a .test-airoapp.ai domain', async function blocksTestAiroappAi() {
      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      const input = document.getElementById('external-domain-input');
      fireEvent.change(input!, { target: { value: 'rjj3iakxkw.c4.test-airoapp.ai' } });

      await waitFor(function waitForError() {
        expect(screen.getByText('builder_domain_error_fqdn_invalid')).toBeInTheDocument();
      });
    });

    it('should not call validation API for blocked airoapp.ai domain', async function skipsApiForBlocked() {
      const { useDomainValidationQuery } = await import('@/hooks/useDomainValidationQuery');
      const mockValidation = vi.mocked(useDomainValidationQuery);

      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      const input = document.getElementById('external-domain-input');
      fireEvent.change(input!, { target: { value: 'someapp.airoapp.ai' } });

      await waitFor(function waitForError() {
        expect(screen.getByText('builder_domain_error_fqdn_invalid')).toBeInTheDocument();
      });

      // Validation query should have been called with enabled: false for the blocked domain
      const lastCall = mockValidation.mock.calls[mockValidation.mock.calls.length - 1];
      expect(lastCall[2].enabled).toBe(false);
    });

    it('should not show error for a regular custom domain', async function allowsRegularDomain() {
      renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      const input = document.getElementById('external-domain-input');
      fireEvent.change(input!, { target: { value: 'mybusiness.com' } });

      await waitFor(function waitForNoError() {
        expect(screen.queryByText('builder_domain_error_fqdn_invalid')).not.toBeInTheDocument();
      });
    });
  });

  describe('feature flag gating', function featureFlagTests() {
    it('should return null when domain attach feature flag is disabled', async function disabled() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useSwitchboard).mockImplementation(function (feature: string) {
        if (feature === 'appbuilder-domain-attach') {
          return false;
        }
        return true;
      });

      const { container } = renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      expect(container.innerHTML).toBe('');
    });

    it('should return null while feature flag is loading', async function loading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useSwitchboard).mockImplementation(function (feature: string) {
        if (feature === 'appbuilder-domain-attach') {
          return undefined;
        }
        return true;
      });

      const { container } = renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

      expect(container.innerHTML).toBe('');
    });
  });

  it('does not render external domain section until app details are fetched', async function waitForAppDetailsFetch() {
    const { useAppDetails } = await import('@/hooks/useAppDetails');

    vi.mocked(useAppDetails).mockReturnValue({
      data: undefined,
      isFetched: false,
    } as any);

    renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

    await waitFor(function waitForExternalSectionToHide() {
      expect(screen.queryByText('builder_domain_attach_external_title')).not.toBeInTheDocument();
      expect(document.getElementById('external-domain-input')).toBeNull();
    });
  });

  it('opens conflict modal for transferable DOMAIN_ALREADY_IN_USE errors', async function opensConflictModalForTransferableMwp() {
    const { DomainMutationError } = await import('@/hooks/useModifyDomains');
    const { useAppDetails } = await import('@/hooks/useAppDetails');
    const { useDomainValidationQuery } = await import('@/hooks/useDomainValidationQuery');
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    const conflictError = new DomainMutationError('Domain already in use');
    (conflictError as any).details = {
      code: 'DOMAIN_MODIFY_FAILED',
      message: 'Domain already in use',
      nestedCode: 'DOMAIN_ALREADY_IN_USE',
      conflictDetails: {
        existingAppId: '1129971',
        existingSystemId: '',
        existingOwnerType: 'mwpV2AppId',
        existingOwnerId: '1129971',
        existingAppName: 'A WordPress Site',
        domain: 'example.com',
      },
    };

    vi.mocked(useAppDetails).mockReturnValue({
      data: {
        id: 'test-app-123',
        name: 'Test App',
        status: 'running',
        domains: [],
      },
      isFetched: true,
    } as any);
    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);
    vi.mocked(useSwitchboard).mockImplementation(function () { return true; });
    vi.mocked(useDomainValidationQuery).mockReturnValue({
      data: { available: true, errors: [] },
      isLoading: false,
      isError: false,
    } as any);
    mockModifyDomainsMutation.mutateAsync = vi.fn().mockRejectedValue(conflictError);

    renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

    const input = document.getElementById('external-domain-input');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'example.com' } });

    await waitFor(function waitForAddButton() {
      expect(screen.getByRole('button', { name: 'builder_custom_domain_button_add' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_button_add' }));
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_continue' }));

    await waitFor(function waitForConflictModal() {
      expect(screen.getByText('Move Domain')).toBeInTheDocument();
    });
  });

  it('falls through to generic error display for non-transferable DOMAIN_ALREADY_IN_USE', async function fallsThroughForNonTransferableMwp() {
    const { DomainMutationError } = await import('@/hooks/useModifyDomains');
    const { useAppDetails } = await import('@/hooks/useAppDetails');
    const { useDomainValidationQuery } = await import('@/hooks/useDomainValidationQuery');
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    const { shipAnalyticsLog } = await import('@/lib/logging');
    const fallbackError = new DomainMutationError('Domain is already configured elsewhere');
    (fallbackError as any).details = {
      code: 'DOMAIN_ALREADY_IN_USE',
      message: 'Domain is already configured elsewhere',
      nestedCode: 'DOMAIN_ALREADY_IN_USE',
    };

    vi.mocked(useAppDetails).mockReturnValue({
      data: {
        id: 'test-app-123',
        name: 'Test App',
        status: 'running',
        domains: [],
      },
      isFetched: true,
    } as any);
    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);
    vi.mocked(useSwitchboard).mockImplementation(function () { return true; });
    vi.mocked(useDomainValidationQuery).mockReturnValue({
      data: { available: true, errors: [] },
      isLoading: false,
      isError: false,
    } as any);
    mockModifyDomainsMutation.mutateAsync = vi.fn(async function rejectWithFallback() {
      mockModifyDomainsMutation.error = fallbackError;
      throw fallbackError;
    });

    renderWithProviders(<DomainAttachWidget appId="test-app-123" />);

    const input = document.getElementById('external-domain-input');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'example.com' } });

    await waitFor(function waitForAddButton() {
      expect(screen.getByRole('button', { name: 'builder_custom_domain_button_add' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_button_add' }));
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_continue' }));

    await waitFor(function waitForGenericFailurePath() {
      expect(vi.mocked(shipAnalyticsLog)).toHaveBeenCalledWith(
        'domain.attach.widget.connect.failed',
        expect.objectContaining({
          appId: 'test-app-123',
          domainName: 'example.com',
        })
      );
    });
    expect(screen.queryByText('Move Domain')).not.toBeInTheDocument();
  });

  describe('CSP instrumentation', function cspInstrumentationTests() {
    it('fires widget_viewed once on mount when domain attach is enabled', async function widgetViewedOnMount() {
      const { useAppDetails } = await import('@/hooks/useAppDetails');
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

      await waitFor(function waitForWidgetViewed() {
        const widgetCalls = vi.mocked(logImpressionEvent).mock.calls.filter(
          ([eid]) => eid === 'develop.domains.widget_viewed',
        );
        expect(widgetCalls).toHaveLength(1);
      });
    });

    it('fires widget_dns_instructions when the DNS instructions panel appears', async function widgetDnsInstructions() {
      const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
      const { useAppDetails } = await import('@/hooks/useAppDetails');

      vi.mocked(useCustomerDomainAttach).mockReturnValue({
        pendingCustomerDomain,
        isPolling: true,
        hasExternalNameservers: true,
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

      await waitFor(function waitForDnsImpression() {
        expect(logImpressionEvent).toHaveBeenCalledWith('develop.domains.widget_dns_instructions');
      });
    });
  });
});
