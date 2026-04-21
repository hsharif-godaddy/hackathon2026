/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => ({
    intl: { locale: 'en-US' },
    cds: { api: { baseUrl: 'https://cds.api.test' } },
  }),
}));

vi.mock('@/hooks/useUpgradePurchase', () => ({
  useUpgradePurchase: () => ({
    handlePurchaseSuccess: vi.fn().mockResolvedValue({ planAfterPurchase: 'starter', updated: true, grantUpdated: true }),
  }),
}));

vi.mock('@/lib/itc', () => ({
  getItcOverride: () => null,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/utils/focus', () => ({
  resetFocusOnModalClose: vi.fn(),
}));

// Mock the CDS loader to avoid dynamic imports
vi.mock('./cdsLoader', () => ({
  ComponentLoader: ({ onClose, source, subType, offerGroupId }: any) => (
    <div data-testid="component-loader">
      <span data-testid="sub-type">{subType}</span>
      <span data-testid="offer-group-id">{offerGroupId}</span>
      <span data-testid="source">{source}</span>
      <button data-testid="close-btn" onClick={onClose}>Close</button>
    </div>
  ),
}));

// Mock the loading modal
vi.mock('./PaywallLoadingModal', () => ({
  PaywallLoadingModal: ({ onClose }: any) => (
    <div data-testid="loading-modal">
      <button onClick={onClose}>Close Loading</button>
    </div>
  ),
  PaywallLoadingModalVariant: {
    HigherPlans: 'higher-plans',
    Credits: 'credits',
  },
}));

// Mock the error fallback
vi.mock('./PaywallErrorFallback', () => ({
  PaywallErrorFallback: ({ error, onClose }: any) => (
    <div data-testid="error-fallback">
      <span>{error?.message}</span>
      <button onClick={onClose}>Close Error</button>
    </div>
  ),
}));

import { shipAnalyticsLog } from '@/lib/logging';
import DirectToPaidContainer from './DirectToPaidContainer';

describe('DirectToPaidContainer', function directToPaidContainerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('should render ComponentLoader with DirectToPaid subType', function renderD2P() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} source="test-source" />
    );

    expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    expect(screen.getByTestId('sub-type')).toHaveTextContent('DirectToPaid');
    expect(screen.getByTestId('offer-group-id')).toHaveTextContent('airoBuilderLineup');
  });

  it('should pass source prop to ComponentLoader', function passSource() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} source="my-custom-source" />
    );

    expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    expect(screen.getByTestId('source')).toHaveTextContent('my-custom-source');
  });

  it('should use default source when not provided', function defaultSource() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} />
    );

    expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    expect(screen.getByTestId('source')).toHaveTextContent('app-builder-D2P');
  });

  it('should log analytics when modal is shown', function logAnalytics() {
    renderWithProviders(
      <DirectToPaidContainer onClose={vi.fn()} source="test" />
    );

    expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.d2p-modal.shown', expect.objectContaining({
      source: 'test',
      productId: 'AiroBuilderProduct',
      offerGroupId: 'airoBuilderLineup',
      component: 'DirectToPaidContainer',
    }));
  });

  it('should call onClose when close button is clicked', function callOnClose() {
    const mockOnClose = vi.fn();

    renderWithProviders(
      <DirectToPaidContainer onClose={mockOnClose} />
    );

    expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    screen.getByTestId('close-btn').click();
    expect(mockOnClose).toHaveBeenCalled();
  });
});
