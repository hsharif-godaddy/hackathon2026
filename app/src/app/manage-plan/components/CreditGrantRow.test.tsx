/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantFinalState, GrantType } from '@/types/credits';
import CreditGrantRow from './CreditGrantRow';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) => {
    if (key === 'builder_manageplan_credits_count' && params) {
      return `${params.spent}/${params.max}`;
    }
    if (params) {
      let result = key;
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, String(v));
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
    useBefore: '2027-02-04T00:00:00.000Z',
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

    it('should render pack name', function renderPackName() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsMax: 5000 })} locale="en-US" />
      );

      expect(screen.getByText('builder_manageplan_pack')).toBeInTheDocument();
    });

    it('should render credits spent and max', function renderCredits() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsSpent: 3491, creditsMax: 5000 })} />
      );

      // Text is split across elements for styling (spent is passive)
      const elements = screen.getAllByText((content, element) => element?.textContent === '3,491/5,000');
      expect(elements.length).toBeGreaterThan(0);
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

      // Two ActiveTags are rendered (mobile and desktop versions)
      const activeTags = screen.getAllByText('builder_manageplan_active');
      expect(activeTags.length).toBe(2);
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

      // Check for expired date text (exact key, not tag)
      expect(screen.getByText('builder_manageplan_expired')).toBeInTheDocument();
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

      // Check for expired date text (exact key, not tag)
      expect(screen.getByText('builder_manageplan_expired')).toBeInTheDocument();
    });
  });

  describe('handles unavailable state styling', function unavailableStateTests() {
    it('should render unavailable grant with appropriate elements', function unavailableRender() {
      const { container } = renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ isAvailable: false, finalState: GrantFinalState.Consumed })} />
      );

      // Component should render without errors when unavailable
      expect(container.firstChild).toBeInTheDocument();
      // The pack name should still be rendered
      expect(screen.getByText('builder_manageplan_pack')).toBeInTheDocument();
    });

    it('should show USED tag when credits are fully consumed before expiration', function showUsedTag() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({
          isAvailable: false,
          finalState: GrantFinalState.Consumed,
          creditsSpent: 5000,
          creditsMax: 5000,
          useBefore: '2027-12-31T00:00:00.000Z', // Future date - consumed before expiration
        })} />
      );

      // Should show USED tag when consumed before useBefore date
      expect(screen.getByText('builder_manageplan_used')).toBeInTheDocument();
    });

    it('should show EXPIRED tag when grant expired by time', function showExpiredTag() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({
          isAvailable: false,
          finalState: GrantFinalState.Expired,
          creditsSpent: 2000,
          creditsMax: 5000,
          useBefore: '2025-01-01T00:00:00.000Z', // Past date - expired by time
        })} />
      );

      // Should show EXPIRED tag when useBefore date has passed
      expect(screen.getByText('builder_manageplan_expired_tag')).toBeInTheDocument();
    });

    it('should not show progress bar when grant is unavailable', function noProgressBarWhenUnavailable() {
      const { container } = renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ isAvailable: false, finalState: GrantFinalState.Consumed })} />
      );

      // Progress bar should not be present when unavailable
      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar).not.toBeInTheDocument();
    });

    it('should show progress bar when grant is available', function showProgressBarWhenAvailable() {
      const { container } = renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ isAvailable: true })} />
      );

      // Progress bar should be present when available
      const progressBar = container.querySelector('[role="progressbar"]');
      expect(progressBar).toBeInTheDocument();
    });
  });

  describe('handles different credit values', function creditValuesTests() {
    it('should handle zero credits spent', function zeroSpent() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsSpent: 0, creditsMax: 5000 })} />
      );

      const elements = screen.getAllByText((content, element) => element?.textContent === '0/5,000');
      expect(elements.length).toBeGreaterThan(0);
    });

    it('should handle fully consumed credits', function fullyConsumed() {
      renderWithProviders(
        <CreditGrantRow grant={createMockGrant({ creditsSpent: 5000, creditsMax: 5000 })} />
      );

      const elements = screen.getAllByText((content, element) => element?.textContent === '5,000/5,000');
      expect(elements.length).toBeGreaterThan(0);
    });
  });
});
