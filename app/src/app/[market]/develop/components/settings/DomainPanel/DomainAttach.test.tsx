/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import type { AppDomain } from '@/hooks/useAppDetails';
import { shipAnalyticsLog } from '@/lib/logging';
import { DomainStatus } from '@/lib/mgmt-airo/types';
import { renderWithProviders } from '@/tests/test-utils';
import DomainAttach from './DomainAttach';

vi.mock('@ux/modal', () => ({
  default: function Modal({ children }: { children: any }) {
    return <div>{children}</div>;
  },
}));

vi.mock('@ux/field-frame', () => ({
  default: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
}));

vi.mock('@ux/text-entry', () => ({
  default: ({ value, onChange, placeholder, 'aria-label': ariaLabel, id, ...props }: any) => (
    <input
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      {...props}
    />
  ),
}));

// -- Hook mocks --

const domainAttachSwitchboardTestState = vi.hoisted(function hoistedSwitchboardState() {
  return {
    domainConnectEnabled: true,
    domainTransferEnabled: true,
  };
});

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn((feature: string) => {
    if (feature === 'appbuilder-domain-connect') {
      return domainAttachSwitchboardTestState.domainConnectEnabled;
    }
    if (feature === 'appbuilder-domain-transfer') {
      return domainAttachSwitchboardTestState.domainTransferEnabled;
    }
    return true;
  }),
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

const {
  mockModifyDomainsMutation,
  mockDomainJobsInProgress,
  mockClearDomainJobInProgress,
} = vi.hoisted(function hoisted() {
  return {
    mockModifyDomainsMutation: {
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
      isError: false,
    },
    mockDomainJobsInProgress: {} as Record<string, { fqdn: string; startedAt: number }>,
    mockClearDomainJobInProgress: vi.fn(function clearDomainJob(appId: string) {
      delete mockDomainJobsInProgress[appId];
    }),
  };
});

vi.mock('@/hooks/useModifyDomains', async function importActual() {
  const actual = await vi.importActual<typeof import('@/hooks/useModifyDomains')>(
    '@/hooks/useModifyDomains',
  );
  return {
    ...actual,
    useModifyDomains: vi.fn(() => mockModifyDomainsMutation),
  };
});

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
  useDevelopPageStore: Object.assign(
    vi.fn((selector: any) => selector({
      domainJobsInProgress: mockDomainJobsInProgress,
    })),
    {
      getState: () => ({
        domainJobsInProgress: mockDomainJobsInProgress,
        clearDomainJobInProgress: mockClearDomainJobInProgress,
      }),
    },
  ),
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

function selectDomainAttachTab(tabId: 'connect' | 'buy' | 'external') {
  const tab = document.getElementById(tabId);
  expect(tab).toBeTruthy();
  fireEvent.pointerDown(tab!);
}

describe('DomainAttach', function domainAttachTests() {
  beforeEach(async function setup() {
    vi.clearAllMocks();
    domainAttachSwitchboardTestState.domainConnectEnabled = true;
    domainAttachSwitchboardTestState.domainTransferEnabled = true;
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
    mockModifyDomainsMutation.error = null;
    mockModifyDomainsMutation.isError = false;
    mockModifyDomainsMutation.mutateAsync = vi.fn();
    mockModifyDomainsMutation.mutate = vi.fn();
    mockModifyDomainsMutation.reset = vi.fn();
    const { useModifyDomains } = await import('@/hooks/useModifyDomains');
    vi.mocked(useModifyDomains).mockReturnValue(mockModifyDomainsMutation as any);
    const { useAppIdFromParams } = await import('@/app/[market]/develop/components/utils');
    vi.mocked(useAppIdFromParams).mockReturnValue('test-app-123');
    Object.keys(mockDomainJobsInProgress).forEach(function clearJob(appId) {
      delete mockDomainJobsInProgress[appId];
    });
    mockClearDomainJobInProgress.mockClear();

    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');
    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);
  });

  it('renders legacy domain attach UI when domain-connect flag is disabled', async function rendersLegacyUiWhenFlagOff() {
    domainAttachSwitchboardTestState.domainConnectEnabled = false;

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForLegacyDomainAttach() {
      expect(screen.getByTestId('domain-attach-list')).toBeInTheDocument();
    });

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'builder_custom_domain_button_buy' })).toBeInTheDocument();
    expect(screen.getByText('builder_custom_domain_input_label')).toBeInTheDocument();
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

  it('shows custom domain input when another domain is active and use other domain is opened', async function showInputForExistingCustomDomain() {
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

    selectDomainAttachTab('external');

    await waitFor(function waitForCustomDomainInput() {
      const input = document.getElementById('custom-domain-slug');
      expect(input).toBeTruthy();
      expect(input).not.toBeDisabled();
    });
  });

  it.each([
    ['DOMAIN_ALREADY_IN_USE', 'mwpV2AppId'],
    ['DOMAIN_IN_USE_BY_OWN_APP', 'airoAppId'],
  ] as const)(
    'opens conflict modal and logs connect.conflict for transferable nestedCode %s',
    async function transferableConflict(nestedCode, existingOwnerType) {
      const { DomainMutationError } = await import('@/hooks/useModifyDomains');
      const { useDomainValidationQuery } = await import('@/hooks/useDomainValidationQuery');
      const conflictError = new DomainMutationError({
        code: 'DOMAIN_MODIFY_FAILED',
        message: 'Domain already in use',
        nestedCode,
        conflictDetails: {
          existingAppId: '1129971',
          existingSystemId: '',
          existingOwnerType,
          existingOwnerId: '1129971',
          existingAppName: 'Other App',
          domain: 'example.com',
        },
      });

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

      selectDomainAttachTab('external');

      const input = document.getElementById('custom-domain-slug');
      expect(input).toBeTruthy();
      fireEvent.change(input!, { target: { value: 'example.com' } });

      await waitFor(function waitForAddButton() {
        expect(screen.getByRole('button', { name: 'builder_domain_attach_external_button' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'builder_domain_attach_external_button' }));
      fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_continue' }));

      await waitFor(function waitForConflictModal() {
        expect(screen.getByText('Move Domain')).toBeInTheDocument();
      });

      expect(shipAnalyticsLog).toHaveBeenCalledWith(
        'domain.custom.connect.conflict',
        expect.objectContaining({
          appId: 'test-app-123',
          domainName: 'example.com',
          nestedCode,
        }),
      );
    },
  );

  it('falls through to generic error display for non-transferable DOMAIN_ALREADY_IN_USE', async function fallsThroughForNonTransferableMwp() {
    const { DomainMutationError } = await import('@/hooks/useModifyDomains');
    const { useDomainValidationQuery } = await import('@/hooks/useDomainValidationQuery');
    const fallbackError = new DomainMutationError({
      code: 'DOMAIN_ALREADY_IN_USE',
      message: 'Domain is already configured elsewhere',
      nestedCode: 'DOMAIN_ALREADY_IN_USE',
    });

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

    selectDomainAttachTab('external');

    const input = document.getElementById('custom-domain-slug');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'example.com' } });

    await waitFor(function waitForAddButton() {
      expect(screen.getByRole('button', { name: 'builder_domain_attach_external_button' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'builder_domain_attach_external_button' }));
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_continue' }));

    await waitFor(function waitForFallbackError() {
      expect(screen.getByText('Translated error')).toBeInTheDocument();
    });
    expect(screen.queryByText('builder_domain_conflict_title')).not.toBeInTheDocument();
  });

  describe('analytics', function analyticsTests() {
    function transitionCalls() {
      return vi.mocked(shipAnalyticsLog).mock.calls.filter(function filterTransitions(call) {
        return call[0] === 'domain.custom.state_transition';
      });
    }

    function customFqdnDomain(fqdn: string, status: string): AppDomain {
      return {
        fqdn,
        isPrimary: false,
        domainType: 'custom',
        status,
      };
    }

    it('does not emit state_transition on initial domain snapshot', async function baselineNoTransition() {
      renderWithProviders(
        <DomainAttach
          appDetails={{
            ...appDetails,
            domains: [customFqdnDomain('snap.example.com', DomainStatus.PENDING)],
          }}
          isAppDetailsFetched={true}
        />
      );

      await waitFor(function settle() {
        expect(transitionCalls()).toHaveLength(0);
      });
    });

    it('does not emit state_transition for customer-type domains', async function customerTypeExcluded() {
      const customerDomain: AppDomain = {
        fqdn: 'shop.example.com',
        isPrimary: false,
        domainType: 'customer',
        status: DomainStatus.PENDING,
      };
      const { rerender } = renderWithProviders(
        <DomainAttach appDetails={{ ...appDetails, domains: [customerDomain] }} isAppDetailsFetched={true} />
      );

      await waitFor(function baseline() {
        expect(transitionCalls()).toHaveLength(0);
      });

      rerender(
        <DomainAttach
          appDetails={{
            ...appDetails,
            domains: [{ ...customerDomain, status: DomainStatus.ACTIVE }],
          }}
          isAppDetailsFetched={true}
        />
      );

      await waitFor(function noCustomerTransition() {
        expect(transitionCalls()).toHaveLength(0);
      });
    });

    it('emits state_transition after status changes once baselined', async function emitsOnChange() {
      const fqdnDomain = customFqdnDomain('track.example.com', DomainStatus.PENDING);
      const { rerender } = renderWithProviders(
        <DomainAttach appDetails={{ ...appDetails, domains: [fqdnDomain] }} isAppDetailsFetched={true} />
      );

      await waitFor(function baseline() {
        expect(transitionCalls()).toHaveLength(0);
      });

      rerender(
        <DomainAttach
          appDetails={{
            ...appDetails,
            domains: [{ ...fqdnDomain, status: DomainStatus.ACTIVE }],
          }}
          isAppDetailsFetched={true}
        />
      );

      await waitFor(function transitioned() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith(
          'domain.custom.state_transition',
          expect.objectContaining({
            appId: 'test-app-123',
            domainName: 'track.example.com',
            prevStatus: DomainStatus.PENDING,
            status: DomainStatus.ACTIVE,
          }),
        );
      });
    });

    it('silently baselines newly seen domains without transition', async function newDomainSilent() {
      const first = customFqdnDomain('a.example.com', DomainStatus.PENDING);
      const { rerender } = renderWithProviders(
        <DomainAttach appDetails={{ ...appDetails, domains: [first] }} isAppDetailsFetched={true} />
      );

      await waitFor(function settle() {
        expect(transitionCalls()).toHaveLength(0);
      });

      rerender(
        <DomainAttach
          appDetails={{
            ...appDetails,
            domains: [first, customFqdnDomain('b.example.com', DomainStatus.PENDING)],
          }}
          isAppDetailsFetched={true}
        />
      );

      await waitFor(function settleAgain() {
        expect(transitionCalls()).toHaveLength(0);
      });
    });

    it('prunes detached domains so re-attach does not compare stale statuses', async function pruneOnDetach() {
      const row = customFqdnDomain('gone.example.com', DomainStatus.ACTIVE);
      const { rerender } = renderWithProviders(
        <DomainAttach appDetails={{ ...appDetails, domains: [row] }} isAppDetailsFetched={true} />
      );

      await waitFor(function settle() {
        expect(transitionCalls()).toHaveLength(0);
      });

      rerender(
        <DomainAttach appDetails={{ ...appDetails, domains: [] }} isAppDetailsFetched={true} />
      );

      rerender(
        <DomainAttach
          appDetails={{
            ...appDetails,
            domains: [{ ...row, status: DomainStatus.PENDING }],
          }}
          isAppDetailsFetched={true}
        />
      );

      await waitFor(function settleAfterRemountPending() {
        expect(transitionCalls()).toHaveLength(0);
      });
    });

    it('reseeds baseline on app id switch before logging transitions', async function appSwitchReseed() {
      const { useAppIdFromParams } = await import('@/app/[market]/develop/components/utils');
      vi.mocked(useAppIdFromParams).mockReturnValue('app-one');
      const d = customFqdnDomain('swap.example.com', DomainStatus.PENDING);
      const { rerender } = renderWithProviders(
        <DomainAttach appDetails={{ ...appDetails, domains: [d] }} isAppDetailsFetched={true} />
      );

      await waitFor(function settleOne() {
        expect(transitionCalls()).toHaveLength(0);
      });

      vi.mocked(shipAnalyticsLog).mockClear();
      vi.mocked(useAppIdFromParams).mockReturnValue('app-two');
      rerender(
        <DomainAttach
          appDetails={{
            ...appDetails,
            domains: [{ ...d, status: DomainStatus.PENDING }],
          }}
          isAppDetailsFetched={true}
        />
      );

      await waitFor(function settleTwo() {
        expect(transitionCalls()).toHaveLength(0);
      });

      rerender(
        <DomainAttach
          appDetails={{
            ...appDetails,
            domains: [{ ...d, status: DomainStatus.ACTIVE }],
          }}
          isAppDetailsFetched={true}
        />
      );

      await waitFor(function afterSecondAppTransition() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith(
          'domain.custom.state_transition',
          expect.objectContaining({
            appId: 'app-two',
            domainName: 'swap.example.com',
            prevStatus: DomainStatus.PENDING,
            status: DomainStatus.ACTIVE,
          }),
        );
      });
    });
  });

  it('clears radio selection and disables Connect Domain when external domain tab is selected', async function clearsSelectionOnExternalTab() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [{ domain: 'available.com', name: 'available.com' }],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForAvailableDomain() {
      expect(screen.getByLabelText('available.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('available.com'));
    expect(screen.getByRole('button', { name: 'builder_domain_button_connect' })).toBeEnabled();

    selectDomainAttachTab('external');

    expect(screen.getByLabelText('available.com', { hidden: true })).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'builder_domain_button_connect', exact: true })).not.toBeInTheDocument();

    selectDomainAttachTab('connect');
    expect(screen.getByLabelText('available.com')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'builder_domain_button_connect' })).toBeDisabled();
  });

  it('switches domains by disconnecting the active domain then connecting the selection', async function switchesActiveDomain() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [
        { domain: 'connected.com', name: 'connected.com' },
        { domain: 'other.com', name: 'other.com' },
      ],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    mockModifyDomainsMutation.mutateAsync = vi.fn().mockResolvedValue({
      statusJobId: 'job-1',
      status: 'pending',
      message: 'ok',
    });

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [{
            fqdn: 'connected.com',
            isPrimary: false,
            status: DomainStatus.ACTIVE,
            domainType: 'custom',
          }],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForDomains() {
      expect(screen.getByLabelText('other.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('other.com'));
    expect(screen.getByRole('button', { name: 'builder_domain_button_connect' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'builder_domain_button_connect' }));
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_continue' }));

    await waitFor(function waitForSwitchMutation() {
      expect(mockModifyDomainsMutation.mutateAsync).toHaveBeenCalledWith({
        siteId: 'test-app-123',
        payload: {
          domainsToCreate: [{ fqdn: 'other.com', primary: false }],
          domainsToDelete: [{ fqdn: 'connected.com' }],
          createCdn: true,
          isWildcardDomain: true,
        },
      });
    });
  });

  it('disables Connect Domain when an active connected domain is selected', async function disablesConnectForActiveSelection() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [{ domain: 'connected.com', name: 'connected.com' }],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [{
            fqdn: 'connected.com',
            isPrimary: false,
            status: DomainStatus.ACTIVE,
            domainType: 'custom',
          }],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForConnectedDomain() {
      expect(screen.getByLabelText('connected.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('connected.com'));
    expect(screen.getByRole('button', { name: 'builder_domain_button_connect' })).toBeDisabled();
  });

  it('shows placeholder in external domain input and disabled connect button before input', async function externalDomainPlaceholderAndButton() {
    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    selectDomainAttachTab('external');

    await waitFor(function waitForExternalInput() {
      expect(screen.getByPlaceholderText('builder_custom_domain_input_help')).toBeInTheDocument();
    });

    expect(screen.getByText('builder_domain_attach_external_description')).toBeInTheDocument();

    const connectButton = screen.getByRole('button', { name: 'builder_domain_attach_external_button' });
    expect(connectButton).toBeDisabled();
    expect(screen.queryByText('builder_custom_domain_input_help')).not.toBeInTheDocument();
  });

  it('does not show connection timing info without an active domain job', async function noTimingInfoByDefault() {
    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForDomainList() {
      expect(screen.getByTestId('domain-attach-list')).toBeInTheDocument();
    });
    expect(
      screen.queryByText('builder_domain_connection_timing_info'),
    ).not.toBeInTheDocument();
  });

  it('does not show connection timing info when domain job is stale with no pending domain', async function staleJobNoTimingInfo() {
    mockDomainJobsInProgress['test-app-123'] = {
      fqdn: 'myexample.com',
      startedAt: Date.now(),
    };

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForDomainList() {
      expect(screen.getByTestId('domain-attach-list')).toBeInTheDocument();
    });
    expect(
      screen.queryByText('builder_domain_connection_timing_info'),
    ).not.toBeInTheDocument();
  });

  it('shows connection timing info in connect tab when a domain job is in progress', async function connectTabTimingInfo() {
    mockDomainJobsInProgress['test-app-123'] = {
      fqdn: 'myexample.com',
      startedAt: Date.now(),
    };

    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');
    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [{ domain: 'myexample.com', name: 'myexample.com' }],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [{
            fqdn: 'myexample.com',
            isPrimary: false,
            status: DomainStatus.PENDING,
            domainType: 'custom',
          }],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForTimingInfo() {
      expect(screen.getByText('builder_domain_connection_timing_info')).toBeInTheDocument();
    });
    expect(screen.getByTestId('domain-attach-list')).toBeInTheDocument();

    selectDomainAttachTab('buy');

    await waitFor(function waitForBuyTab() {
      const timingInfo = screen.queryByText(
        'builder_domain_connection_timing_info',
        { hidden: true },
      );
      expect(timingInfo).toBeInTheDocument();
      expect(timingInfo).not.toBeVisible();
    });
  });

  it('shows buy tab description and purchase link', async function buyTabContent() {
    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForBuyContent() {
      expect(
        screen.getByText('builder_domain_attach_buy_description'),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'builder_domain_attach_buy_button' })).toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'builder_domain_attach_tab_domains' }),
    ).not.toBeInTheDocument();
    const domainList = screen.queryByTestId('domain-attach-list', { hidden: true });
    expect(domainList).toBeInTheDocument();
    expect(domainList).not.toBeVisible();
  });

  it('hides GoDaddy domains tab and defaults to buy tab when domain list is empty', async function hideConnectTabWhenEmpty() {
    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForBuyTabDefault() {
      expect(
        screen.getByText('builder_domain_attach_buy_description'),
      ).toBeVisible();
    });
    expect(
      screen.queryByRole('tab', { name: 'builder_domain_attach_tab_domains' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'builder_domain_attach_tab_buy' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'builder_domain_attach_tab_external' })).toBeInTheDocument();
  });

  it('renders the domain list inside a fixed-height scroll area', async function listIsScrollArea() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [
        { domain: 'alpha.com', name: 'alpha.com' },
        { domain: 'beta.com', name: 'beta.com' },
        { domain: 'gamma.com', name: 'gamma.com' },
      ],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForDomainList() {
      expect(screen.getByTestId('domain-attach-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('domain-attach-list')).toHaveClass('overflow-y-auto');
  });

  it('paginates the domain list when the count exceeds one page', async function paginatesLongList() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    // 16 domains > DOMAIN_LIST_PER_PAGE (15), so the last one spills to page two.
    const manyDomains = Array.from({ length: 16 }, (_unused, index) => {
      const fqdn = `domain-${String(index + 1).padStart(2, '0')}.com`;
      return { domain: fqdn, name: fqdn };
    });

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: manyDomains,
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForDomainList() {
      expect(screen.getByTestId('domain-attach-list')).toBeInTheDocument();
    });

    // The first page renders the earlier entries while the 16th is held on page two.
    expect(screen.getByLabelText('domain-01.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('domain-16.com')).not.toBeInTheDocument();
  });

  it('filters the domain list to matching domains when a search query is entered', async function filtersBySearchQuery() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [
        { domain: 'alpha.com', name: 'alpha.com' },
        { domain: 'beta.com', name: 'beta.com' },
        { domain: 'gamma.com', name: 'gamma.com' },
      ],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForDomains() {
      expect(screen.getByLabelText('alpha.com')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('builder_domain_list_search_placeholder');
    fireEvent.change(searchInput, { target: { value: 'alpha' } });

    await waitFor(function waitForFilter() {
      expect(screen.getByLabelText('alpha.com')).toBeInTheDocument();
      expect(screen.queryByLabelText('beta.com')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('gamma.com')).not.toBeInTheDocument();
    });
  });

  it('shows a no-results message when the search query matches no domains', async function showsNoResultsMessage() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [
        { domain: 'alpha.com', name: 'alpha.com' },
        { domain: 'beta.com', name: 'beta.com' },
        { domain: 'gamma.com', name: 'gamma.com' },
      ],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForDomains() {
      expect(screen.getByLabelText('alpha.com')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('builder_domain_list_search_placeholder');
    fireEvent.change(searchInput, { target: { value: 'zzz-no-match' } });

    await waitFor(function waitForEmptyState() {
      expect(screen.getByText('builder_domain_list_no_results')).toBeInTheDocument();
      expect(screen.queryByLabelText('alpha.com')).not.toBeInTheDocument();
    });
  });

  it('clears stale domain job from store when attach completes', async function clearStaleDomainJobWhenComplete() {
    mockDomainJobsInProgress['test-app-123'] = {
      fqdn: 'completed.com',
      startedAt: Date.now(),
    };

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [{
            fqdn: 'completed.com',
            isPrimary: false,
            status: DomainStatus.ACTIVE,
            domainType: 'custom',
          }],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForJobClear() {
      expect(mockClearDomainJobInProgress).toHaveBeenCalledWith('test-app-123');
    });
  });

  it('disables Connect Domain without a radio selection', async function connectSelectedDisabledWithoutSelection() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [{ domain: 'available.com', name: 'available.com' }],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForAvailableDomain() {
      expect(screen.getByLabelText('available.com')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'builder_domain_button_connect' })).toBeDisabled();

    fireEvent.click(screen.getByLabelText('available.com'));

    expect(screen.getByRole('button', { name: 'builder_domain_button_connect' })).toBeEnabled();
  });

  it('closes connect confirmation without calling mutate when Cancel is clicked', async function connectModalCancel() {
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [{ domain: 'available.com', name: 'available.com' }],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForAvailableDomain() {
      expect(screen.getByLabelText('available.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('available.com'));
    fireEvent.click(screen.getByRole('button', { name: 'builder_domain_button_connect' }));

    await waitFor(function waitForConfirmation() {
      expect(screen.getByText('builder_domain_connect_confirmation_description')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_cancel' }));

    await waitFor(function waitForModalClose() {
      expect(screen.queryByText('builder_domain_connect_confirmation_description')).not.toBeInTheDocument();
    });
    expect(mockModifyDomainsMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps connect confirmation open when connect mutation fails', async function connectMutationFailure() {
    const { DomainMutationError } = await import('@/hooks/useModifyDomains');
    const { useDomainsQuery } = await import('@/hooks/useDomainsQuery');
    const connectError = new DomainMutationError({
      code: 'DOMAIN_MODIFY_FAILED',
      message: 'Connect failed',
      nestedCode: 'UNKNOWN_ERROR',
    });

    vi.mocked(useDomainsQuery).mockReturnValue({
      data: [{ domain: 'available.com', name: 'available.com' }],
      isLoading: false,
      error: null,
      isFetched: true,
    } as any);
    mockModifyDomainsMutation.mutateAsync = vi.fn().mockRejectedValue(connectError);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForAvailableDomain() {
      expect(screen.getByLabelText('available.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('available.com'));
    fireEvent.click(screen.getByRole('button', { name: 'builder_domain_button_connect' }));
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_continue' }));

    await waitFor(function waitForMutationAttempt() {
      expect(mockModifyDomainsMutation.mutateAsync).toHaveBeenCalled();
    });
    expect(screen.getByText('builder_domain_connect_confirmation_description')).toBeInTheDocument();
  });

  it('suppresses connect tab error banner when conflict modal handles the error', async function suppressBannerWhenConflictModalOpen() {
    const { DomainMutationError } = await import('@/hooks/useModifyDomains');
    const { useDomainValidationQuery } = await import('@/hooks/useDomainValidationQuery');
    const conflictError = new DomainMutationError({
      code: 'DOMAIN_MODIFY_FAILED',
      message: 'Domain already in use',
      nestedCode: 'DOMAIN_IN_USE_BY_OWN_APP',
      conflictDetails: {
        existingAppId: '1129971',
        existingSystemId: '',
        existingOwnerType: 'airoAppId',
        existingOwnerId: '1129971',
        existingAppName: 'Other App',
        domain: 'example.com',
      },
    });

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

    selectDomainAttachTab('external');

    const input = document.getElementById('custom-domain-slug');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'example.com' } });

    await waitFor(function waitForAddButton() {
      expect(screen.getByRole('button', { name: 'builder_domain_attach_external_button' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'builder_domain_attach_external_button' }));
    fireEvent.click(screen.getByRole('button', { name: 'builder_custom_domain_modal_button_continue' }));

    await waitFor(function waitForConflictModal() {
      expect(screen.getByText('Move Domain')).toBeInTheDocument();
    });
    expect(screen.queryByText('builder_domain_attach_connect_error')).not.toBeInTheDocument();
  });

  it('shows connect tab error banner for conflict when transfer flag is off', async function conflictBannerWhenTransferOff() {
    const { DomainMutationError } = await import('@/hooks/useModifyDomains');
    const { useModifyDomains } = await import('@/hooks/useModifyDomains');
    domainAttachSwitchboardTestState.domainTransferEnabled = false;
    const conflictError = new DomainMutationError({
      code: 'DOMAIN_MODIFY_FAILED',
      message: 'Domain already in use',
      nestedCode: 'DOMAIN_IN_USE_BY_OWN_APP',
    });

    vi.mocked(useModifyDomains).mockReturnValue({
      ...mockModifyDomainsMutation,
      error: conflictError,
      isError: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForConflictBanner() {
      expect(
        screen.getByText('Something went wrong connecting your domain. Please try again.'),
      ).toBeInTheDocument();
    });
  });

  it('shows connect tab mutation error banner when modify domains fails', async function connectTabMutationBanner() {
    const { useModifyDomains } = await import('@/hooks/useModifyDomains');
    const connectError = new Error('Connect failed');

    vi.mocked(useModifyDomains).mockReturnValue({
      ...mockModifyDomainsMutation,
      error: connectError,
      isError: true,
    } as any);

    renderWithProviders(
      <DomainAttach
        appDetails={{
          id: 'test-app-123',
          name: 'Test App',
          status: 'running',
          domains: [],
        } as any}
        isAppDetailsFetched={true}
      />
    );

    await waitFor(function waitForBanner() {
      expect(document.body.textContent).toContain('Connect failed');
    });
  });
});
