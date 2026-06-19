/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DomainPurchaseWidget from './DomainPurchaseWidget';

const {
  mockCheckoutProps,
  mockUseSwitchboard,
  mockUseDomainSearch,
  mockUseIscResolver,
  mockUseOfferEligibility,
} = vi.hoisted(() => ({
  mockCheckoutProps: { current: null as any },
  mockUseSwitchboard: vi.fn(function () { return true; }),
  mockUseDomainSearch: vi.fn(
    function () { return { data: null, isLoading: false, error: null }; }
  ),
  mockUseIscResolver: vi.fn(function () { return { isc: null, source: null }; }),
  mockUseOfferEligibility: vi.fn(function () { return { eligible: false }; }),
}));

// -- Hook mocks --

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
}));

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: mockUseDomainSearch,
}));

vi.mock('@/hooks/useIscResolver', () => ({
  useIscResolver: mockUseIscResolver,
}));

vi.mock('@/hooks/useOfferEligibility', () => ({
  useOfferEligibility: mockUseOfferEligibility,
}));

vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: vi.fn(function () { return vi.fn(); }),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(function () { return 'test-app-123'; }),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn(function (selector: any) { return selector({
      getSite: () => ({ id: 'test-app-123', name: 'Test App' }),
    }); }
  ),
}));

// -- Utility / logging mocks --

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(function () { return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ apiKeyName: 'test-api-key' }),
    }); }
  ),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

const { shipAnalyticsLog } = await import('@/lib/logging');
const mockShipAnalyticsLog = vi.mocked(shipAnalyticsLog);

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: vi.fn(function () { return 'godaddy.com'; }),
}));

vi.mock('@/utils/reactCompat', () => ({
  shimReactInternals: vi.fn(),
}));

vi.mock('@/utils/instrumentation', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/instrumentation')>();
  return { ...actual, logImpressionEvent: vi.fn(function () { return vi.fn(); }) };
});

const { logImpressionEvent } = await import('@/utils/instrumentation');
const mockLogImpressionEvent = vi.mocked(logImpressionEvent);

// -- External package mocks --

vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockCheckout(props: any) {
      mockCheckoutProps.current = props;
      return <div data-testid="mock-checkout" />;
    };
  },
}));

vi.mock('@site/buttons/lib/AddToCartButton', () => ({
  default: ({ successCallback, buttonText, domain }: any) => (
    <button
      data-testid={`add-to-cart-${domain?.fqdn || 'unknown'}`}
      onClick={() => successCallback?.({ basketId: 'mock-basket-123' })}
    >
      {buttonText || 'Add'}
    </button>
  ),
}));

vi.mock('@ux/modal', () => ({
  default: ({ children, onClose, title }: any) => (
    <div data-testid="checkout-modal" role="dialog" aria-label={title}>
      <button data-testid="modal-close" onClick={onClose}>
        Close
      </button>
      {children}
    </div>
  ),
}));

vi.mock('@ux/alert', () => ({
  default: ({ children, onClose }: any) => (
    <div data-testid="checkout-error-alert" role="alert">
      {children}
      {onClose && (
        <button data-testid="alert-close" onClick={onClose}>
          Dismiss
        </button>
      )}
    </div>
  ),
}));

// -- Test data --

const mockDomain = {
  fqdn: 'testapp.com',
  sld: 'testapp',
  tld: '.com',
  availabilityCode: 1000,
  productId: 1,
  isPremium: false,
  isExactMatch: true,
  priceDisplay: '$12.99',
  _raw: { fqdn: 'testapp.com', sld: 'testapp', tld: '.com' },
};

const mockProduct = {
  productId: 1,
  priceInfo: {
    listPrice: 1299,
    listPriceDisplay: '$12.99',
    currentPrice: 1299,
    currentPriceDisplay: '$12.99',
    renewalPrice: 1999,
    renewalPriceDisplay: '$19.99',
    isOnSale: false,
  },
};

const mockSearchMeta = {
  seedsUsed: 'fallback' as const,
  seedsCount: 0,
  spinsFulfilled: 1,
  spinsRejected: 0,
  spinsResultCount: 0,
  exactMatchCount: 1,
  totalBeforeCap: 1,
};

function mockSearchResults(meta = mockSearchMeta) {
  mockUseDomainSearch.mockReturnValue({
    data: { domains: [mockDomain], products: [mockProduct], meta },
    isLoading: false,
    error: null,
  });
}

describe('DomainPurchaseWidget', function () {
  beforeEach(function () {
    vi.clearAllMocks();
    mockUseSwitchboard.mockImplementation(
      function () { return true; }
    );
    mockUseDomainSearch.mockImplementation(
      function () { return { data: null, isLoading: false, error: null }; }
    );
    mockUseIscResolver.mockImplementation(
      function () { return { isc: null, source: null }; }
    );
    mockUseOfferEligibility.mockImplementation(
      function () { return { eligible: false }; }
    );
    mockCheckoutProps.current = null;
  });

  it('returns null when feature flag is disabled', function () {
    mockUseSwitchboard.mockReturnValue(false);

    const { container } = renderWithProviders(
      <DomainPurchaseWidget brandName="testapp" />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders search form when enabled', function () {
    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    expect(
      screen.getByText('builder_domain_purchase_search_button')
    ).toBeInTheDocument();
  });

  it('restores search input after checkout error', async function () {
    mockSearchResults();

    const { user } = renderWithProviders(
      <DomainPurchaseWidget brandName="testapp" />
    );

    const addToCartButton = await screen.findByTestId(
      'add-to-cart-testapp.com'
    );

    // Search form visible initially
    expect(
      screen.getByText('builder_domain_purchase_search_button')
    ).toBeInTheDocument();

    // Add to cart → hides search, shows checkout modal
    await user.click(addToCartButton);
    expect(
      screen.queryByText('builder_domain_purchase_search_button')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-modal')).toBeInTheDocument();
    expect(screen.getByTestId('mock-checkout')).toBeInTheDocument();

    // Trigger checkout error via captured DynamicCheckout props
    act(() => {
      mockCheckoutProps.current.onError({
        name: 'CheckoutError',
        message: 'Payment failed',
        reasonCode: 'CARD_DECLINED',
      });
    });

    // Search form should be restored (the fix in handleCheckoutError)
    expect(
      screen.getByText('builder_domain_purchase_search_button')
    ).toBeInTheDocument();

    // Error alert visible in modal
    expect(screen.getByTestId('checkout-error-alert')).toBeInTheDocument();
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
  });

  it('restores search input when dismissing checkout modal', async function () {
    mockSearchResults();

    const { user } = renderWithProviders(
      <DomainPurchaseWidget brandName="testapp" />
    );

    const addToCartButton = await screen.findByTestId(
      'add-to-cart-testapp.com'
    );
    await user.click(addToCartButton);

    // Search hidden during checkout
    expect(
      screen.queryByText('builder_domain_purchase_search_button')
    ).not.toBeInTheDocument();

    // Close modal → handleBackFromCheckout restores search
    await user.click(screen.getByTestId('modal-close'));
    expect(
      screen.getByText('builder_domain_purchase_search_button')
    ).toBeInTheDocument();
  });
});

describe('DomainPurchaseWidget — search results analytics', function () {
  beforeEach(function () {
    vi.clearAllMocks();
    mockUseSwitchboard.mockReturnValue(true);
    mockUseDomainSearch.mockReturnValue({ data: null, isLoading: false, error: null });
  });

  it('emits domain.search.results once when results with meta render', async function emitOnce() {
    mockSearchResults();

    const { rerender } = renderWithProviders(
      <DomainPurchaseWidget brandName="testapp" />
    );

    await screen.findByTestId('add-to-cart-testapp.com');

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('domain.search.results', {
      appId: 'test-app-123',
      query: 'testapp',
      domainsFound: 1,
      spinsResultCount: 0,
      exactMatchCount: 1,
      seedsUsed: 'fallback',
      seedsCount: 0,
      spinsFulfilled: 1,
      spinsRejected: 0,
    });

    rerender(<DomainPurchaseWidget brandName="testapp" />);
    await act(async () => { await Promise.resolve(); });

    expect(mockShipAnalyticsLog.mock.calls.filter(
      ([event]) => event === 'domain.search.results'
    )).toHaveLength(1);
  });

  it('does not emit domain.search.results when meta is absent', async function noMeta() {
    mockUseDomainSearch.mockReturnValue({
      data: { domains: [mockDomain], products: [mockProduct] },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);
    await screen.findByTestId('add-to-cart-testapp.com');

    expect(mockShipAnalyticsLog).not.toHaveBeenCalledWith(
      'domain.search.results',
      expect.anything(),
    );
  });

  it('does not emit domain.search.results when search has no results', function noResults() {
    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    expect(mockShipAnalyticsLog).not.toHaveBeenCalledWith(
      'domain.search.results',
      expect.anything(),
    );
  });
});

describe('DomainPurchaseWidget — ISC offer flow', function () {
  let mockedAppFetch: ReturnType<typeof vi.fn>;

  beforeEach(async function () {
    vi.clearAllMocks();
    mockUseSwitchboard.mockReturnValue(true);
    mockUseDomainSearch.mockImplementation(
      function () { return { data: null, isLoading: false, error: null }; }
    );
    mockUseIscResolver.mockReturnValue({ isc: null, source: null });
    mockUseOfferEligibility.mockReturnValue({ eligible: false });
    const mod = await import('@/lib/gasket-config');
    mockedAppFetch = vi.mocked(mod.appFetch);
    mockedAppFetch.mockImplementation(function (url: string) {
      if (typeof url === 'string' && url.includes('/api/domains/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ apiKeyName: 'test-api-key' }),
        } as Response);
      }
      if (typeof url === 'string' && url.includes('/api/domains/isc-session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, isc: 'GDWELCOME' }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  function findIscSessionCalls() {
    return mockedAppFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/api/domains/isc-session')
    );
  }

  it('does NOT call /api/domains/isc-session when no ISC is resolved', async function () {
    mockUseIscResolver.mockReturnValue({ isc: null, source: null });
    mockUseOfferEligibility.mockReturnValue({ eligible: false });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    await act(async () => { await Promise.resolve(); });
    expect(findIscSessionCalls()).toHaveLength(0);
  });

  it('does NOT call /api/domains/isc-session when ISC present but ineligible', async function () {
    mockUseIscResolver.mockReturnValue({ isc: 'GDWELCOME', source: 'url' });
    mockUseOfferEligibility.mockReturnValue({ eligible: false });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    await act(async () => { await Promise.resolve(); });
    expect(findIscSessionCalls()).toHaveLength(0);
  });

  it('calls /api/domains/isc-session with the ISC when eligible', async function () {
    mockUseIscResolver.mockReturnValue({ isc: 'GDWELCOME', source: 'url' });
    mockUseOfferEligibility.mockReturnValue({ eligible: true });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    await act(async () => { await Promise.resolve(); });
    const calls = findIscSessionCalls();
    expect(calls).toHaveLength(1);
    const [, init] = calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ isc: 'GDWELCOME' });
  });

  it('passes resolved ISC into useDomainSearch when eligible', async function () {
    mockUseIscResolver.mockReturnValue({ isc: 'GDWELCOME', source: 'url' });
    mockUseOfferEligibility.mockReturnValue({ eligible: true });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    const lastCall = mockUseDomainSearch.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ isc: 'GDWELCOME' });
  });

  it('omits ISC from useDomainSearch when ineligible', async function () {
    mockUseIscResolver.mockReturnValue({ isc: 'GDWELCOME', source: 'url' });
    mockUseOfferEligibility.mockReturnValue({ eligible: false });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    const lastCall = mockUseDomainSearch.mock.calls.at(-1)?.[0];
    expect(lastCall?.isc).toBeUndefined();
  });

  it('does not crash when the mint call fails', async function () {
    mockedAppFetch.mockImplementation(function (url: string) {
      if (typeof url === 'string' && url.includes('/api/domains/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ apiKeyName: 'test-api-key' }),
        } as Response);
      }
      if (typeof url === 'string' && url.includes('/api/domains/isc-session')) {
        return Promise.reject(new Error('upstream timeout'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });
    mockUseIscResolver.mockReturnValue({ isc: 'GDWELCOME', source: 'url' });
    mockUseOfferEligibility.mockReturnValue({ eligible: true });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    await act(async () => { await Promise.resolve(); });
    expect(
      screen.getByText('builder_domain_purchase_search_button')
    ).toBeInTheDocument();
  });

  it('renders the offer disclaimer when an ISC is active and eligible', async function () {
    mockUseDomainSearch.mockReturnValue({
      data: { domains: [mockDomain], products: [mockProduct] },
      isLoading: false,
      error: null,
    });
    mockUseIscResolver.mockReturnValue({ isc: 'GDWELCOME', source: 'url' });
    mockUseOfferEligibility.mockReturnValue({ eligible: true });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    expect(
      screen.getByTestId('domain-offer-disclaimer')
    ).toBeInTheDocument();
  });

  it('does NOT render the offer disclaimer when no ISC is active', async function () {
    mockUseDomainSearch.mockReturnValue({
      data: { domains: [mockDomain], products: [mockProduct] },
      isLoading: false,
      error: null,
    });
    mockUseIscResolver.mockReturnValue({ isc: null, source: null });
    mockUseOfferEligibility.mockReturnValue({ eligible: false });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    expect(
      screen.queryByTestId('domain-offer-disclaimer')
    ).not.toBeInTheDocument();
  });

  it('treats ISC as inactive when the appbuilder-domain-offers-isc Switchboard flag is off', async function () {
    // Both the parent appbuilder-domain-purchase (true) and the offer-specific
    // appbuilder-domain-offers-isc (false). The widget should still render
    // (parent flag gates rendering), but the offer flow stays dormant.
    mockUseSwitchboard.mockImplementation(function (name: string) {
      if (name === 'appbuilder-domain-offers-isc') return false;
      return true;
    });
    mockUseDomainSearch.mockReturnValue({
      data: { domains: [mockDomain], products: [mockProduct] },
      isLoading: false,
      error: null,
    });
    mockUseIscResolver.mockReturnValue({ isc: 'GDWELCOME', source: 'url' });
    mockUseOfferEligibility.mockReturnValue({ eligible: true });

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    await act(async () => { await Promise.resolve(); });

    // No mint call — would otherwise have fired since isc + eligible
    expect(findIscSessionCalls()).toHaveLength(0);

    // No ISC threaded into search
    const searchOpts = mockUseDomainSearch.mock.calls.at(-1)?.[0];
    expect(searchOpts?.isc).toBeUndefined();

    // No offer disclaimer
    expect(
      screen.queryByTestId('domain-offer-disclaimer')
    ).not.toBeInTheDocument();
  });
});

describe('DomainPurchaseWidget — impression analytics', function () {
  beforeEach(function () {
    vi.clearAllMocks();
    mockUseSwitchboard.mockReturnValue(true);
    mockUseDomainSearch.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseIscResolver.mockReturnValue({ isc: null, source: null });
    mockUseOfferEligibility.mockReturnValue({ eligible: false });
  });

  it('emits chat.domainPurchase.view impression once when the widget appears', async function () {
    const { rerender } = renderWithProviders(
      <DomainPurchaseWidget brandName="testapp" />
    );

    await screen.findByText('builder_domain_purchase_search_button');

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('chat.domainPurchase.view', {
      from_domain_attach: false,
    });

    rerender(<DomainPurchaseWidget brandName="testapp" />);
    await act(async () => { await Promise.resolve(); });

    expect(mockLogImpressionEvent.mock.calls.filter(
      ([eid]) => eid === 'chat.domainPurchase.view'
    )).toHaveLength(1);
  });

  it('marks from_domain_attach true when launched from the attach flow', async function () {
    renderWithProviders(
      <DomainPurchaseWidget brandName="testapp" onCancel={vi.fn()} />
    );

    await screen.findByText('builder_domain_purchase_search_button');

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('chat.domainPurchase.view', {
      from_domain_attach: true,
    });
  });

  it('does not emit the impression when the feature flag is disabled', function () {
    mockUseSwitchboard.mockReturnValue(false);

    renderWithProviders(<DomainPurchaseWidget brandName="testapp" />);

    expect(mockLogImpressionEvent).not.toHaveBeenCalledWith(
      'chat.domainPurchase.view',
      expect.anything(),
    );
  });
});
