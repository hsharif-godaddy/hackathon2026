/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import type { AppDomain } from '@/hooks/useAppDetails';
import { DomainStatus } from '@/lib/mgmt-airo/types';
import { renderWithProviders } from '@/tests/test-utils';
import DomainAttach from './DomainAttach';

vi.mock('@ux/modal', () => ({
  default: function Modal({ children }: { children: any }) {
    return <div>{children}</div>;
  },
}));

// -- Hook mocks --

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => (true)),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true, isLoading: false })),
}));

vi.mock('@/hooks/useCloseOnReauth', () => ({
  useCloseOnReauth: vi.fn(),
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
    hasExternalNameservers: false,
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

vi.mock('@/hooks/useDomainDnsOwnership', () => ({
  useDomainDnsOwnership: vi.fn(() => ({
    data: { isGdDomain: false },
    isPending: false,
    isLoading: false,
    isError: false,
  })),
}));

vi.mock('@/app/[market]/develop/components/settings/SettingsSection', () => ({
  default: function SettingsSection({ children }: { children: any }) {
    return <div>{children}</div>;
  },
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
  useModifyDomains: vi.fn(() => mockModifyDomainsMutation),
  DomainMutationError: class extends Error {},
}));

// -- Component utility mocks --

vi.mock('@/app/[market]/develop/components/utils', () => ({
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

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn((selector: any) => selector({
    domainJobsInProgress: {},
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

const appDetails = {
  id: 'test-app-123',
  name: 'Test App',
  status: 'running',
  domains: [pendingCustomerDomain],
} as any;

describe('DomainAttach', function domainAttachTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockModifyDomainsMutation.error = null;
    mockModifyDomainsMutation.isError = false;
    mockModifyDomainsMutation.mutateAsync = vi.fn();
    mockModifyDomainsMutation.mutate = vi.fn();
    mockModifyDomainsMutation.reset = vi.fn();
  });

  it('renders DNS instructions when domain-dns-ownership errors', async function renderDnsOnOwnershipError() {
    const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
    const { useDomainDnsOwnership } = await import('@/hooks/useDomainDnsOwnership');

    vi.mocked(useCustomerDomainAttach).mockReturnValue({
      pendingCustomerDomain,
      isPolling: true,
      hasExternalNameservers: true,
      requiresManualDnsSetup: true,
    });

    vi.mocked(useDomainDnsOwnership).mockReturnValue({
      data: undefined,
      isPending: false,
      isLoading: false,
      isError: true,
    } as any);

    renderWithProviders(<DomainAttach appDetails={appDetails} isAppDetailsFetched={true} />);

    await waitFor(function waitForDnsInstructions() {
      expect(screen.getByText('builder_domain_dns_instructions')).toBeInTheDocument();
    });

    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
  });

  it('does not render DNS instructions when gd-domain data exists and refetch errors', async function hideDnsForStaleGdDataOnError() {
    const { useCustomerDomainAttach } = await import('@/hooks/useCustomerDomainAttach');
    const { useDomainDnsOwnership } = await import('@/hooks/useDomainDnsOwnership');

    vi.mocked(useCustomerDomainAttach).mockReturnValue({
      pendingCustomerDomain,
      isPolling: true,
      hasExternalNameservers: true,
      requiresManualDnsSetup: true,
    });

    vi.mocked(useDomainDnsOwnership).mockReturnValue({
      data: { isGdDomain: true },
      isPending: false,
      isLoading: false,
      isError: true,
    } as any);

    renderWithProviders(<DomainAttach appDetails={appDetails} isAppDetailsFetched={true} />);

    await waitFor(function waitForNoDnsInstructions() {
      expect(screen.queryByText('builder_domain_dns_instructions')).not.toBeInTheDocument();
    });
  });

  it('hides custom domain input when non-customer custom domain is already active', async function hideInputForExistingCustomDomain() {
    const activeCustomDomain: AppDomain = {
      fqdn: 'external-only.com',
      isPrimary: false,
      status: DomainStatus.ACTIVE,
      domainType: 'custom',
    };

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [activeCustomDomain],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForCustomDomainInputToHide() {
      expect(document.getElementById('custom-domain-slug')).toBeNull();
    });
  });

  it('opens conflict modal for transferable DOMAIN_ALREADY_IN_USE errors', async function opensConflictModalForTransferableMwp() {
    const { DomainMutationError } = await import('@/hooks/useModifyDomains');
    const { useDomainValidationQuery } = await import('@/hooks/useDomainValidationQuery');
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

    vi.mocked(useDomainValidationQuery).mockReturnValue({
      data: { available: true, errors: [] },
      isLoading: false,
      isError: false,
    } as any);
    mockModifyDomainsMutation.mutateAsync = vi.fn().mockRejectedValue(conflictError);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          ...appDetails,
          domains: [],
        }}
        isAppDetailsFetched={true}
      />
    );

    const input = document.getElementById('custom-domain-slug');
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
    const { useDomainValidationQuery } = await import('@/hooks/useDomainValidationQuery');
    const fallbackError = new DomainMutationError('Domain is already configured elsewhere');
    (fallbackError as any).details = {
      code: 'DOMAIN_ALREADY_IN_USE',
      message: 'Domain is already configured elsewhere',
      nestedCode: 'DOMAIN_ALREADY_IN_USE',
    };

    vi.mocked(useDomainValidationQuery).mockReturnValue({
      data: { available: true, errors: [] },
      isLoading: false,
      isError: false,
    } as any);
    mockModifyDomainsMutation.mutateAsync = vi.fn(async function rejectWithFallback() {
      mockModifyDomainsMutation.error = fallbackError;
      throw fallbackError;
    });

    renderWithProviders(
      <DomainAttach
        appDetails={{
          ...appDetails,
          domains: [],
        }}
        isAppDetailsFetched={true}
      />
    );

    const input = document.getElementById('custom-domain-slug');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'example.com' } });

    await waitFor(function waitForAddButton() {
      expect(screen.getByRole('button', { name: 'builder_custom_domain_button_add' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_button_add' }));
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_continue' }));

    await waitFor(function waitForFallbackError() {
      expect(screen.getByText('Translated error')).toBeInTheDocument();
    });
    expect(screen.queryByText('builder_domain_conflict_title')).not.toBeInTheDocument();
  });
});
