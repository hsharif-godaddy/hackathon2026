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
    if (params) {
      let result: string = key;
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
    creditsSpent: 2500,
    isAvailable: true,
    finalState: null,
    useBefore: '2027-02-04T00:00:00.000Z',
    consumedAt: null,
    createdAt: '2026-01-04T00:00:00.000Z',
    updatedAt: '2026-01-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('CreditGrantRow (v2)', function creditGrantRowV2Tests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders grant information', function renderTests() {
    it('should render pack name', function renderPackName() {
      renderWithProviders(<CreditGrantRow grant={createMockGrant()} locale="en-US" />);

      expect(screen.getByText('builder_manageplan_pack')).toBeInTheDocument();
    });

    it('should render purchased date', function renderPurchasedDate() {
      renderWithProviders(<CreditGrantRow grant={createMockGrant()} locale="en-US" />);

      expect(screen.getByText(/builder_manageplan_purchased_on/)).toBeInTheDocument();
    });

    it('should render expires text for active grant with useBefore', function rendersExpiresText() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({ isAvailable: true, finalState: null, useBefore: '2027-12-31T00:00:00.000Z' })}
          locale="en-US"
        />
      );

      expect(screen.getByText(/builder_manageplan_expires/)).toBeInTheDocument();
    });

    it('should not render expires text when useBefore is null', function noExpiresTextWhenNull() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({ isAvailable: true, finalState: null, useBefore: null })}
          locale="en-US"
        />
      );

      expect(screen.queryByText(/builder_manageplan_expires/)).not.toBeInTheDocument();
    });
  });

  describe('renders progress bar for active grants', function progressBarTests() {
    it('should show progress bar for active grant', function showsProgressBar() {
      const { container } = renderWithProviders(<CreditGrantRow grant={createMockGrant()} />);

      expect(container.querySelector('[role="progressbar"]')).toBeInTheDocument();
    });

    it('should not show progress bar for unavailable grant', function hidesProgressBar() {
      const { container } = renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({ isAvailable: false, finalState: GrantFinalState.Consumed })}
        />
      );

      expect(container.querySelector('[role="progressbar"]')).not.toBeInTheDocument();
    });

    it('should not show progress bar for grant expired by date', function hidesProgressBarForExpiredByDate() {
      const { container } = renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({ isAvailable: true, useBefore: '2020-01-01T00:00:00.000Z' })}
        />
      );

      expect(container.querySelector('[role="progressbar"]')).not.toBeInTheDocument();
    });
  });

  describe('handles active state', function activeStateTests() {
    it('should not show unavailable tags when grant is available', function noUnavailableTagsWhenAvailable() {
      renderWithProviders(<CreditGrantRow grant={createMockGrant()} />);

      expect(screen.queryByText('builder_manageplan_expired_tag')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_manageplan_used')).not.toBeInTheDocument();
    });

    it('should show progress bar when grant is available (not unavailable state)', function showsProgressBarWhenAvailable() {
      const { container } = renderWithProviders(<CreditGrantRow grant={createMockGrant()} />);

      expect(container.querySelector('[role="progressbar"]')).toBeInTheDocument();
    });

    it('should not show ActiveTag for unavailable grant', function hidesActiveTagForUnavailable() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({ isAvailable: false, finalState: GrantFinalState.Expired })}
        />
      );

      expect(screen.queryByText('builder_manageplan_active')).not.toBeInTheDocument();
    });
  });

  describe('handles unavailable states', function unavailableTests() {
    it('should show EXPIRED tag for expired grant', function showsExpiredTag() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: false,
            finalState: GrantFinalState.Expired,
            useBefore: '2025-01-01T00:00:00.000Z',
          })}
        />
      );

      expect(screen.getByText('builder_manageplan_expired_tag')).toBeInTheDocument();
    });

    it('should show EXPIRED tag for grant expired by date', function showsExpiredTagByDate() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: true,
            useBefore: '2020-01-01T00:00:00.000Z',
          })}
        />
      );

      expect(screen.getByText('builder_manageplan_expired_tag')).toBeInTheDocument();
    });

    it('should show USED tag for consumed grant', function showsUsedTag() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: false,
            finalState: GrantFinalState.Consumed,
            useBefore: '2027-12-31T00:00:00.000Z',
          })}
        />
      );

      expect(screen.getByText('builder_manageplan_used')).toBeInTheDocument();
    });

    it('should show used_date text for consumed grant', function showsUsedDateForConsumed() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: false,
            finalState: GrantFinalState.Consumed,
            consumedAt: '2026-03-01T00:00:00.000Z',
          })}
          locale="en-US"
        />
      );

      expect(screen.getAllByText(/builder_manageplan_used_date/).length).toBeGreaterThan(0);
    });

    it('should not render epoch date when both useBefore and consumedAt are null', function noEpochDate() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: false,
            finalState: GrantFinalState.Consumed,
            useBefore: null,
            consumedAt: null,
          })}
          locale="en-US"
        />
      );

      expect(screen.queryByText(/1969/)).not.toBeInTheDocument();
      expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    });
  });

  describe('does not show expiration text for consumed/expired grants in left column', function leftColumnTests() {
    it('should not show expires text in left column for consumed grant', function noExpiresInLeftColumnForConsumed() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: false,
            finalState: GrantFinalState.Consumed,
            useBefore: '2027-12-31T00:00:00.000Z',
          })}
          locale="en-US"
        />
      );

      expect(screen.queryByText(/builder_manageplan_expires/)).not.toBeInTheDocument();
    });

    it('should not show expires text in left column for expired grant', function noExpiresInLeftColumnForExpired() {
      renderWithProviders(
        <CreditGrantRow
          grant={createMockGrant({
            isAvailable: false,
            finalState: GrantFinalState.Expired,
            useBefore: '2025-01-01T00:00:00.000Z',
          })}
          locale="en-US"
        />
      );

      expect(screen.queryByText(/builder_manageplan_expires/)).not.toBeInTheDocument();
    });
  });
});
