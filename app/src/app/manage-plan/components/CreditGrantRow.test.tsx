import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantFinalState, GrantType } from '@/types/credits';
import CreditGrantRow from './CreditGrantRow';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (params) {
      let result = key;
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, v);
      });
      return result;
    }
    return key;
  },
}));

function createMockGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'grant-1',
    subscriptionId: 'sub-1',
    type: GrantType.CreditPack,
    llmBudgetUserId: 'user-1',
    llmBudgetId: 'budget-1',
    creditsMax: 5000,
    creditsSpent: 3491,
    isAvailable: true,
    finalState: null,
    useBefore: '2026-02-04T00:00:00.000Z',
    consumedAt: null,
    createdAt: '2026-01-04T00:00:00.000Z',
    updatedAt: '2026-01-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('CreditGrantRow', function creditGrantRowTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders grant information', function renderTests() {
    it('should render purchased date', function renderPurchasedDate() {
      renderWithProviders(<CreditGrantRow grant={createMockGrant()} locale="en-US" />);

      expect(screen.getByText(/builder_manageplan_purchased_on/)).toBeInTheDocument();
    });

    it('should render pack name based on creditsMax', function renderPackName() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsMax: 5000 })} locale="en-US" />
      );

      expect(screen.getByText('builder_manageplan_pack_medium')).toBeInTheDocument();
    });

    it('should render small pack name for <= 2500 credits', function smallPack() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsMax: 2500 })} locale="en-US" />
      );

      expect(screen.getByText('builder_manageplan_pack_small')).toBeInTheDocument();
    });

    it('should render large pack name for > 5000 credits', function largePack() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsMax: 10000 })} locale="en-US" />
      );

      expect(screen.getByText('builder_manageplan_pack_large')).toBeInTheDocument();
    });

    it('should render credits spent and max', function renderCredits() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsSpent: 3491, creditsMax: 5000 })} />
      );

      expect(screen.getByText('3,491')).toBeInTheDocument();
      expect(screen.getByText('5,000')).toBeInTheDocument();
    });

    it('should render progress bar', function renderProgressBar() {
      const { container } = renderWithProviders(<CreditGrantRow grant={createMockGrant()} />);

      // Progress bar should be present (outer container)
      const progressBar = container.querySelector('[class*="rounded-full"]');
      expect(progressBar).toBeInTheDocument();
    });
  });

  describe('handles active state', function activeStateTests() {
    it('should show ActiveTag when isActive is true', function showActiveTag() {
      renderWithProviders(<CreditGrantRow grant={createMockGrant()} isActive={true} />);

      expect(screen.getByText('builder_manageplan_active')).toBeInTheDocument();
    });

    it('should not show ActiveTag when isActive is false', function hideActiveTag() {
      renderWithProviders(<CreditGrantRow grant={createMockGrant()} isActive={false} />);

      expect(screen.queryByText('builder_manageplan_active')).not.toBeInTheDocument();
    });
  });

  describe('handles expiration states', function expirationStateTests() {
    it('should show expires text for available grant', function showExpires() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({ isAvailable: true, finalState: null })}
          locale="en-US"
        />
      );

      expect(screen.getByText(/builder_manageplan_expires/)).toBeInTheDocument();
    });

    it('should show expired text for consumed grant', function showExpiredConsumed() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: false,
            finalState: GrantFinalState.Consumed,
            consumedAt: '2026-01-20T00:00:00.000Z',
          })}
          locale="en-US"
        />
      );

      expect(screen.getByText(/builder_manageplan_expired/)).toBeInTheDocument();
    });

    it('should show expired text for expired grant', function showExpiredExpired() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: false,
            finalState: GrantFinalState.Expired,
          })}
          locale="en-US"
        />
      );

      expect(screen.getByText(/builder_manageplan_expired/)).toBeInTheDocument();
    });
  });

  describe('handles unavailable state styling', function unavailableStateTests() {
    it('should render unavailable grant with appropriate elements', function unavailableRender() {
      const { container } = renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ isAvailable: false })} />
      );

      // Component should render without errors when unavailable
      expect(container.firstChild).toBeInTheDocument();
      // The pack name should still be rendered
      expect(screen.getByText('builder_manageplan_pack_medium')).toBeInTheDocument();
    });

    it('should pass isExpired to CreditProgressBar when unavailable', function expiredProgressBar() {
      const { container } = renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ isAvailable: false })} />
      );

      // Progress bar should have opacity class when expired
      const progressBar = container.querySelector('[class*="opacity-50"]');
      expect(progressBar).toBeInTheDocument();
    });

    it('should not have opacity when available', function noOpacityWhenAvailable() {
      const { container } = renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ isAvailable: true })} />
      );

      // Progress bar should not have opacity class
      const progressBar = container.querySelector('[class*="rounded-full"]');
      expect(progressBar?.className).not.toContain('opacity-50');
    });
  });

  describe('handles different credit values', function creditValuesTests() {
    it('should handle zero credits spent', function zeroSpent() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsSpent: 0, creditsMax: 5000 })} />
      );

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should handle fully consumed credits', function fullyConsumed() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsSpent: 5000, creditsMax: 5000 })} />
      );

      // Both values should be 5,000
      const texts = screen.getAllByText('5,000');
      expect(texts).toHaveLength(2);
    });
  });
});
