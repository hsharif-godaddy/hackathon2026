/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DomainPurchaseWidget from './DomainPurchaseWidget';

const { mockCheckoutProps, mockUseSwitchboard, mockUseDomainSearch } =
  vi.hoisted(() => ({
    mockCheckoutProps: { current: null as any },
    mockUseSwitchboard: vi.fn((): any => (true)),
    mockUseDomainSearch: vi.fn(
      (): any => ({ data: null, isLoading: false, error: null })
    ),
  }));

// -- Hook mocks --

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
}));

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: mockUseDomainSearch,
}));

vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: vi.fn(() => vi.fn()),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-123'),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn((selector: any) =>
    selector({
      getSite: () => ({ id: 'test-app-123', name: 'Test App' }),
    })
  ),
}));

// -- Utility / logging mocks --

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ apiKeyName: 'test-api-key' }),
    })
  ),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: vi.fn(() => 'godaddy.com'),
}));

vi.mock('@/utils/reactCompat', () => ({
  shimReactInternals: vi.fn(),
}));

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

function mockSearchResults() {
  mockUseDomainSearch.mockReturnValue({
    data: { domains: [mockDomain], products: [mockProduct] },
    isLoading: false,
    error: null,
  });
}

describe('DomainPurchaseWidget', function () {
  beforeEach(function () {
    vi.clearAllMocks();
    mockUseSwitchboard.mockImplementation(
      (): any => (true)
    );
    mockUseDomainSearch.mockImplementation(
      (): any => ({ data: null, isLoading: false, error: null })
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
