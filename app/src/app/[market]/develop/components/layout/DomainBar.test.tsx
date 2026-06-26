/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DomainBar from './DomainBar';

const mockDevelopStore: any = {
  site: {
    name: 'Test App',
    domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
  },
  app: { name: 'Test App' },
  deploymentInProgressId: null,
  setActiveChatTab: vi.fn(),
  domainJobsInProgress: {},
};

const mockShipAnalyticsLog = vi.fn();
const mockSendMessage = vi.fn();
const mockGetSite = vi.fn(function (_id: string) { return null; });
// vi.hoisted: these are referenced eagerly inside vi.mock factories (hoisted above
// the imports), so they must be initialized before those factories run.
const { mockPostToSapi, mockAddGrowl, mockIsLoading, mockIsStreaming, mockMutateAsync, mockAddCompletedMessage, mockLogImpressionEvent, mockLogClickEvent, mockUseQuery, mockUseSwitchboard } = vi.hoisted(() => ({
  mockPostToSapi: vi.fn(function () { return Promise.resolve({ basketId: 'basket-1', cartCount: 1 }); }),
  mockAddGrowl: vi.fn(),
  mockIsLoading: vi.fn(function () { return false; }),
  mockIsStreaming: vi.fn(function () { return false; }),
  mockMutateAsync: vi.fn(function () { return Promise.resolve({ statusJobId: 'job-1', status: 'RUNNING', message: 'ok' }); }),
  mockAddCompletedMessage: vi.fn(),
  // logImpressionEvent/logClickEvent return a fire fn the caller invokes; the mock
  // returns a no-op so the outer mock captures (eid, props) for assertions.
  mockLogImpressionEvent: vi.fn(function () { return vi.fn(); }),
  mockLogClickEvent: vi.fn(function () { return vi.fn(); }),
  // domainConfig query — default resolves the api key; override per-test for not-ready cases.
  mockUseQuery: vi.fn(function () { return { data: { apiKeyName: 'test-key' }, isLoading: false }; }),
  // appbuilder-domain-expedite-purchase Switchboard flag — default OFF (control); override per-test.
  mockUseSwitchboard: vi.fn(function () { return false; }),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(function () { return 'app-123'; }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn(function (selector: any) { return selector({
      getSite: () => null,
    }); },
  ),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: mockIsStreaming,
  useIsLoading: mockIsLoading,
  useStreamingConversationStore: (selector: any) => selector({ addCompletedMessage: mockAddCompletedMessage }),
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({ sendMessage: mockSendMessage }),
}));
vi.mock('@/hooks/useSwitchboard', () => ({ useSwitchboard: mockUseSwitchboard }));
vi.mock('@/hooks/useModifyDomains', () => ({ useModifyDomains: () => ({ mutateAsync: mockMutateAsync }) }));
vi.mock('@site/buttons/lib/services/DomainServices', () => ({ postToSapi: mockPostToSapi }));
vi.mock('@ux/growl', () => ({ default: { addGrowlMessage: mockAddGrowl } }));
vi.mock('@/utils/getRootDomain', () => ({ getRootDomain: () => 'godaddy.com' }));
vi.mock('@/lib/paywall/shared', () => ({ PAYWALL_ITC: { DOMAIN_PURCHASE: 'itc-domain', DOMAIN_EXPEDITE_PURCHASE: 'itc-domain-expedite-purchase' } }));
vi.mock('@/lib/gasket-config', () => ({ appFetch: vi.fn() }));
vi.mock('@/app/[market]/develop/components/widgets/DomainCheckoutModal', () => ({
  default: ({ basketId, onPurchaseSuccess, onError }: any) => (
    <div data-testid="checkout-modal">
      {basketId}
      <button data-testid="mock-complete-purchase" onClick={() => onPurchaseSuccess({ orderId: 'test-order' })}>
        Complete
      </button>
      <button data-testid="mock-checkout-error" onClick={() => onError({ name: 'CheckoutError', reasonCode: 'DECLINED' })}>
        Error
      </button>
    </div>
  ),
}));

// Keep QueryClientProvider intact; drive the domainConfig query via mockUseQuery.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: mockUseQuery };
});

// Keep IntlProvider (used by renderWithProviders); render only the `{domain}` Button so
// the test can click the suggested-domain control directly.
vi.mock('react-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-intl')>();
  return { ...actual, FormattedMessage: ({ values }: any) => values?.domain ?? null };
});

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: vi.fn(function () { return { data: null, isError: false }; }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id) { return id; }),
  logImpressionEvent: mockLogImpressionEvent,
  logClickEvent: mockLogClickEvent,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(function () { return mockShipAnalyticsLog; }),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(function () { return true; }),
}));

vi.mock('@/utils/domain', () => ({
  isAiroSubdomain: vi.fn(function (fqdn: string) { return fqdn?.includes('airoapp.ai'); }),
  resolveSiteFqdn: vi.fn(function (site: any) { return site?.domains?.[0]?.fqdn || null; }),
}));

// Import mocked modules to control their behavior
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useDomainSearch } from '@/hooks/useDomainSearch';
import { shipAnalyticsLog } from '@/lib/logging';
import { useSiteStore } from '@/stores/useSiteStore';

describe('DomainBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSite.mockReset();
    mockGetSite.mockImplementation(function () { return null; });
    vi.mocked(useAppIdFromParams).mockReturnValue('app-123');
    vi.mocked(useSiteStore).mockImplementation(function (selector: any) { return selector({
        getSite: mockGetSite,
      }); },
    );
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };
    mockDevelopStore.app = { name: 'Test App' };
    mockDevelopStore.domainJobsInProgress = {};
    sessionStorage.clear();
  });

  it('should not render for custom domains', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'custom.example.com', domainType: 'custom' }],
    };

    const { container } = renderWithProviders(<DomainBar />);
    expect(container.firstChild).toBeNull();
  });

  it('should not render when no domain suggestion available', () => {
    vi.mocked(useDomainSearch).mockReturnValue({
      data: null,
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);
    expect(container.firstChild).toBeNull();
  });

  it('should render when domain suggestion is available', () => {
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'testapp.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    // Should render the purple suggestion bar
    const bar = container.querySelector('.bg-ai');
    expect(bar).toBeInTheDocument();
  });

  it('should pass appId as siteId to useDomainSearch (required for LLM seed pre-call)', () => {
    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'app-123' })
    );
  });

  it('should disable search when appId is unavailable', () => {
    vi.mocked(useAppIdFromParams).mockReturnValue(undefined);

    renderWithProviders(<DomainBar />);

    const lastCall = vi.mocked(useDomainSearch).mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall?.siteId).toBeUndefined();
    expect(lastCall?.enabled).toBe(false);
  });

  it('should normalize diacritics to ASCII in domain query', () => {
    mockDevelopStore.site = {
      name: 'Manoirs Lotbinière',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'manoirslotbiniere' })
    );
  });

  it('should normalize mixed diacritics in domain query', () => {
    mockDevelopStore.site = {
      name: 'Café Résumé',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'caferesume' })
    );
  });

  it('should use site name when app name is missing', () => {
    mockDevelopStore.app = {};
    mockDevelopStore.site = {
      name: 'Site Only Brand',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'siteonlybrand' })
    );
  });

  it('should use site name when app name is an empty string', () => {
    mockDevelopStore.app = { name: '' };
    mockDevelopStore.site = {
      name: 'Empty App Site Name',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'emptyappsitename' })
    );
  });

  it('should prefer site name over app name when both exist', () => {
    mockDevelopStore.app = { name: 'App Preferred' };
    mockDevelopStore.site = {
      name: 'Site Other',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }],
    };

    renderWithProviders(<DomainBar />);

    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'siteother' })
    );
  });

  it('should prefer cached site when getSite returns published airo subdomain and develop store differs', () => {
    mockDevelopStore.app = {};
    mockDevelopStore.site = {
      name: 'Stale Unpublished',
      domains: [{ fqdn: 'custom-stale.example.com', domainType: 'custom' }],
    };
    const cachedPublished = {
      name: 'Cached Published',
      variants: ['publish'],
      domains: [{ fqdn: 'cached.airoapp.ai', domainType: 'prefix' }],
    };
    vi.mocked(useSiteStore).mockImplementation(function (selector: any) { return selector({
        getSite: (id: string) => (id === 'app-123' ? cachedPublished : null),
      }); },
    );
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'cachedbrand.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    expect(container.querySelector('.bg-ai')).toBeInTheDocument();
    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        query: 'cachedpublished',
      }),
    );
  });

  it('should not render when cached site is custom domain even if develop site is airo subdomain', () => {
    mockDevelopStore.site = {
      name: 'Develop Airo',
      domains: [{ fqdn: 'develop.airoapp.ai', domainType: 'prefix' }],
    };
    const cachedCustom = {
      name: 'Cached Custom',
      domains: [{ fqdn: 'owner-custom.example.com', domainType: 'custom' }],
    };
    vi.mocked(useSiteStore).mockImplementation(function (selector: any) { return selector({
        getSite: (id: string) => (id === 'app-123' ? cachedCustom : null),
      }); },
    );
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'ignored.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    expect(container.firstChild).toBeNull();
  });

  it('should skip getSite and use develop site when appId is absent', () => {
    vi.mocked(useAppIdFromParams).mockReturnValue(undefined);
    vi.mocked(useDomainSearch).mockReturnValue({
      data: {
        domains: [{ fqdn: 'fallback.com', available: true }],
      },
      isError: false,
    } as any);

    const { container } = renderWithProviders(<DomainBar />);

    expect(mockGetSite).not.toHaveBeenCalled();
    expect(container.querySelector('.bg-ai')).toBeInTheDocument();
    expect(useDomainSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        query: 'testapp',
      }),
    );
  });

  describe('dismiss functionality', () => {
    beforeEach(() => {
      vi.mocked(useDomainSearch).mockReturnValue({
        data: {
          domains: [{ fqdn: 'testapp.com', available: true }],
        },
        isError: false,
      } as any);
    });

    it('should render dismiss button when domain suggestion is available', () => {
      const { container } = renderWithProviders(<DomainBar />);

      const dismissButton = container.querySelector('button[aria-label="builder_preview_bar_dismiss"]');
      expect(dismissButton).toBeInTheDocument();
    });

    it('should hide DomainBar when dismiss button is clicked', async () => {
      const { container } = renderWithProviders(<DomainBar />);

      const dismissButton = container.querySelector('button[aria-label="builder_preview_bar_dismiss"]');
      expect(dismissButton).toBeInTheDocument();

      fireEvent.click(dismissButton!);

      await waitFor(() => {
        const bar = container.querySelector('.bg-ai');
        expect(bar).not.toBeInTheDocument();
      });
    });

    it('should store dismissal state in sessionStorage', () => {
      const { container } = renderWithProviders(<DomainBar />);

      const dismissButton = container.querySelector('button[aria-label="builder_preview_bar_dismiss"]');
      fireEvent.click(dismissButton!);

      expect(sessionStorage.getItem('domainbar_dismissed')).toBe('true');
    });

    it('should log analytics event when dismissed', () => {
      const { container } = renderWithProviders(<DomainBar />);

      const dismissButton = container.querySelector('button[aria-label="builder_preview_bar_dismiss"]');
      fireEvent.click(dismissButton!);

      expect(shipAnalyticsLog).toHaveBeenCalledWith('domain.suggestion.dismissed', {
        appId: 'app-123',
        suggestedDomain: 'testapp.com',
      });
    });

    it('should not render when previously dismissed in session', () => {
      sessionStorage.setItem('domainbar_dismissed', 'true');

      const { container } = renderWithProviders(<DomainBar />);

      const bar = container.querySelector('.bg-ai');
      expect(bar).not.toBeInTheDocument();
    });

    it('should render again after sessionStorage is cleared', () => {
      sessionStorage.setItem('domainbar_dismissed', 'true');

      let result = renderWithProviders(<DomainBar />);
      expect(result.container.querySelector('.bg-ai')).not.toBeInTheDocument();

      // Clear and re-render
      sessionStorage.clear();
      result.unmount();

      result = renderWithProviders(<DomainBar />);
      expect(result.container.querySelector('.bg-ai')).toBeInTheDocument();
    });
  });

  describe('expedite checkout (add-to-cart on click)', () => {
    beforeEach(() => {
      vi.mocked(useDomainSearch).mockReturnValue({
        data: { domains: [{ fqdn: 'testapp.com', available: true }] },
        isError: false,
      } as any);
      mockIsLoading.mockReturnValue(false);
      mockIsStreaming.mockReturnValue(false);
      mockPostToSapi.mockResolvedValue({ basketId: 'basket-1', cartCount: 1 });
      mockMutateAsync.mockResolvedValue({ statusJobId: 'job-1', status: 'RUNNING', message: 'ok' });
      mockUseQuery.mockReturnValue({ data: { apiKeyName: 'test-key' }, isLoading: false });
      mockSendMessage.mockResolvedValue(undefined);
      // domain-expedite-purchase flag ON for the expedite path.
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('flag OFF: clicking sends a chat prompt and does NOT add to cart', async () => {
      mockUseSwitchboard.mockReturnValue(false);

      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      await waitFor(() =>
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: 'builder_custom_domain_suggestion_prompt_domain',
        }),
      );
      expect(mockUseSwitchboard).toHaveBeenCalledWith('appbuilder-domain-expedite-purchase');
      expect(mockPostToSapi).not.toHaveBeenCalled();
      expect(screen.queryByTestId('checkout-modal')).not.toBeInTheDocument();
      // Control cohort skips the domains-config request.
      expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    it('flag OFF: surfaces an error growl when the chat prompt fails to send', async () => {
      mockUseSwitchboard.mockReturnValue(false);
      mockSendMessage.mockRejectedValue(new Error('send failed'));

      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      await waitFor(() =>
        expect(mockAddGrowl).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'domain-suggestion-error' }),
        ),
      );
    });

    it('flag ON: enables the domains-config query', () => {
      renderWithProviders(<DomainBar />);
      expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    });

    it('clicking the domain adds to cart, opens checkout, and notifies chat', async () => {
      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      await waitFor(() => expect(mockPostToSapi).toHaveBeenCalledTimes(1));
      expect(mockPostToSapi.mock.calls[0][0]).toMatchObject({ fqdn: 'testapp.com', apiKey: 'test-key', itemTrackingCode: 'itc-domain-expedite-purchase' });

      await screen.findByTestId('checkout-modal');
      expect(screen.getByTestId('checkout-modal')).toHaveTextContent('basket-1');
      // Acknowledged locally (no agent round-trip) to avoid a doomed turn the attach
      // redeploy would kill with a spurious "Connection lost".
      expect(mockAddCompletedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: "Heads up: I'm buying testapp.com in the checkout window — it will be connected to the site automatically once purchased, so no action or follow-up is needed from you.",
        }),
      );
      // CSP impression fires when the checkout modal opens.
      await waitFor(() =>
        expect(mockLogImpressionEvent).toHaveBeenCalledWith(
          'develop.preview.domain_checkout_modal',
          { suggested_domain: 'testapp.com' },
        ),
      );
    });

    it('with no apiKey resolved, shows an error growl and does not open checkout', async () => {
      // Config resolved but empty (endpoint failed/returned no key).
      mockUseQuery.mockReturnValue({ data: { apiKeyName: '' }, isLoading: false });

      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      await waitFor(() =>
        expect(mockAddGrowl).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'domain-suggestion-error' }),
        ),
      );
      expect(mockPostToSapi).not.toHaveBeenCalled();
      expect(screen.queryByTestId('checkout-modal')).not.toBeInTheDocument();
    });

    it('while apiKey config is still loading, shows the busy growl', async () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: true });

      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      await waitFor(() =>
        expect(mockAddGrowl).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'domain-suggestion-busy' }),
        ),
      );
      expect(mockPostToSapi).not.toHaveBeenCalled();
    });

    it('shows a busy growl and does not add to cart while processing', async () => {
      mockIsLoading.mockReturnValue(true);

      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      await waitFor(() =>
        expect(mockAddGrowl).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'domain-suggestion-busy' }),
        ),
      );
      expect(mockPostToSapi).not.toHaveBeenCalled();
      expect(screen.queryByTestId('checkout-modal')).not.toBeInTheDocument();
    });

    it('shows an error growl and no checkout when add-to-cart fails', async () => {
      mockPostToSapi.mockRejectedValue(new Error('sapi down'));

      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      await waitFor(() =>
        expect(mockAddGrowl).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'domain-suggestion-error' }),
        ),
      );
      expect(screen.queryByTestId('checkout-modal')).not.toBeInTheDocument();
    });

    it('completing checkout attaches the purchased domain to the site', async () => {
      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      // Checkout modal opens; click its (mocked) complete-purchase trigger.
      const completeBtn = await screen.findByTestId('mock-complete-purchase');
      fireEvent.click(completeBtn);

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
        siteId: 'app-123',
        payload: { domainsToCreate: [{ fqdn: 'testapp.com', primary: false }], createCdn: true },
      });
      // CSP click fires when the purchase completes.
      expect(mockLogClickEvent).toHaveBeenCalledWith(
        'develop.preview.domain_checkout_complete',
        expect.objectContaining({ suggested_domain: 'testapp.com' }),
      );
      // Chat confirms the purchase + attach on completion — injected locally, not via
      // the agent (the attach redeploy would otherwise kill the turn with "Connection lost").
      await waitFor(() =>
        expect(mockAddCompletedMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'user',
            content: "Done: testapp.com is purchased and is already being connected to the site automatically. No action needed — please don't start a domain connect or purchase flow.",
          }),
        ),
      );
      await waitFor(() => expect(screen.queryByTestId('checkout-modal')).not.toBeInTheDocument());
    });

    it('shows a checkout-error growl and dismisses the modal when checkout fails', async () => {
      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      // Checkout modal opens; trigger its (mocked) error callback.
      const errorBtn = await screen.findByTestId('mock-checkout-error');
      fireEvent.click(errorBtn);

      await waitFor(() =>
        expect(mockAddGrowl).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'domain-suggestion-checkout-error' }),
        ),
      );
      // Checkout failed → no attach, no purchase-confirmation chat message.
      expect(mockMutateAsync).not.toHaveBeenCalled();
      expect(mockAddCompletedMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('is purchased') }),
      );
      await waitFor(() => expect(screen.queryByTestId('checkout-modal')).not.toBeInTheDocument());
    });

    it('shows an attach-error growl and no purchase-confirmation when auto-attach fails after purchase', async () => {
      // Domain was purchased (money spent) but the auto-attach call rejects — the
      // highest-value error path: the user must not be told it succeeded.
      mockMutateAsync.mockRejectedValue(new Error('attach failed'));

      renderWithProviders(<DomainBar />);
      fireEvent.click(screen.getByText('testapp.com'));

      const completeBtn = await screen.findByTestId('mock-complete-purchase');
      fireEvent.click(completeBtn);

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(mockAddGrowl).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'domain-suggestion-attach-error' }),
        ),
      );
      // The "Done: … is purchased" confirmation must NOT be injected when attach failed.
      expect(mockAddCompletedMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('is purchased') }),
      );
    });

    it('does not render while a domain attach job is in progress', () => {
      vi.mocked(useDomainSearch).mockReturnValue({
        data: { domains: [{ fqdn: 'testapp.com', available: true }] },
        isError: false,
      } as any);
      mockDevelopStore.domainJobsInProgress = {
        'app-123': { fqdn: 'testapp.com', startedAt: 1, jobStatus: 'RUNNING' },
      };

      const { container } = renderWithProviders(<DomainBar />);
      expect(container.firstChild).toBeNull();
    });

    it('does not render while a custom domain is pending (connecting)', () => {
      vi.mocked(useDomainSearch).mockReturnValue({
        data: { domains: [{ fqdn: 'testapp.com', available: true }] },
        isError: false,
      } as any);
      // Still on the Airo subdomain (prefix is the resolved fqdn), but a custom domain is
      // mid-connect — the banner should hide for the whole pending window.
      mockDevelopStore.site = {
        name: 'Test App',
        domains: [
          { fqdn: 'test.airoapp.ai', domainType: 'prefix', status: 'active' },
          { fqdn: 'mybrand.com', domainType: 'custom', status: 'pending' },
        ],
      };

      const { container } = renderWithProviders(<DomainBar />);
      expect(container.firstChild).toBeNull();
    });

    it('does not render when a custom domain is in error status (slot still occupied)', () => {
      vi.mocked(useDomainSearch).mockReturnValue({
        data: { domains: [{ fqdn: 'testapp.com', available: true }] },
        isError: false,
      } as any);
      // A prior attach failed and left the custom domain in 'error' status. mgmt-airo still
      // treats the slot as occupied (409 CUSTOM_DOMAIN_SLOT_OCCUPIED), so the bar must hide —
      // selling a domain here would charge the user and then fail to auto-attach.
      mockDevelopStore.site = {
        name: 'Test App',
        domains: [
          { fqdn: 'test.airoapp.ai', domainType: 'prefix', status: 'active' },
          { fqdn: 'broken.com', domainType: 'custom', status: 'error' },
        ],
      };

      const { container } = renderWithProviders(<DomainBar />);
      expect(container.firstChild).toBeNull();
    });

    it('renders again when the only custom domain is inactive (removed)', () => {
      vi.mocked(useDomainSearch).mockReturnValue({
        data: { domains: [{ fqdn: 'testapp.com', available: true }] },
        isError: false,
      } as any);
      mockDevelopStore.site = {
        name: 'Test App',
        domains: [
          { fqdn: 'test.airoapp.ai', domainType: 'prefix', status: 'active' },
          { fqdn: 'mybrand.com', domainType: 'custom', status: 'inactive' },
        ],
      };

      const { container } = renderWithProviders(<DomainBar />);
      expect(container.querySelector('.bg-ai')).toBeInTheDocument();
    });
  });

});
