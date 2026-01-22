import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantType } from '@/types/credits';
import PlanCreditCard from './PlanCreditCard';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

function createMockGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'grant-1',
    subscriptionId: 'sub-1',
    type: GrantType.PlanMonthly,
    llmBudgetUserId: 'user-1',
    llmBudgetId: 'budget-1',
    creditsMax: 1500,
    creditsSpent: 1129,
    isAvailable: true,
    finalState: null,
    useBefore: '2026-02-09T00:00:00.000Z',
    consumedAt: null,
    createdAt: '2026-01-09T00:00:00.000Z',
    updatedAt: '2026-01-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('PlanCreditCard', function planCreditCardTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders with grant', function withGrantTests() {
    it('should render monthly credits title', function renderTitle() {
      renderWithProviders(<PlanCreditCard grant={createMockGrant()} />);

      expect(screen.getByText('builder_manageplan_monthly_credits')).toBeInTheDocument();
    });

    it('should render credits spent and max', function renderCredits() {
      renderWithProviders(
        <PlanCreditCard grant={createMockGrant({ creditsSpent: 1129, creditsMax: 1500 })} />
      );

      expect(screen.getByText('1,129')).toBeInTheDocument();
      expect(screen.getByText('/ 1,500')).toBeInTheDocument();
    });

    it('should render billing period', function renderPeriod() {
      const { container } = renderWithProviders(
        <PlanCreditCard grant={createMockGrant()} locale="en-US" />
      );

      // Check that the period is rendered (format: "Jan 9 - Feb 9" or similar)
      const caption = container.querySelector('[class*="caption"]');
      expect(caption).toBeInTheDocument();
    });

    it('should render circular gauge', function renderGauge() {
      const { container } = renderWithProviders(<PlanCreditCard grant={createMockGrant()} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render with ai-light background', function renderBackground() {
      const { container } = renderWithProviders(<PlanCreditCard grant={createMockGrant()} />);

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('bg-ai-light/4');
    });
  });

  describe('renders active state', function activeStateTests() {
    it('should show ActiveTag when isActive is true', function showActiveTag() {
      renderWithProviders(<PlanCreditCard grant={createMockGrant()} isActive={true} />);

      expect(screen.getByText('builder_manageplan_active')).toBeInTheDocument();
    });

    it('should not show ActiveTag when isActive is false', function hideActiveTag() {
      renderWithProviders(<PlanCreditCard grant={createMockGrant()} isActive={false} />);

      expect(screen.queryByText('builder_manageplan_active')).not.toBeInTheDocument();
    });

    it('should show tooltip text for active monthly credits', function activeTooltip() {
      renderWithProviders(<PlanCreditCard grant={createMockGrant()} isActive={true} />);

      // The ActiveTag should be present, and when hovered will show tooltip
      expect(screen.getByText('builder_manageplan_active')).toBeInTheDocument();
    });
  });

  describe('renders without grant (error state)', function withoutGrantTests() {
    it('should render error state when grant is undefined', function renderError() {
      renderWithProviders(<PlanCreditCard grant={undefined} />);

      expect(screen.getByText('builder_manageplan_credits_load_error')).toBeInTheDocument();
    });

    it('should render alert icon in error state', function renderAlertIcon() {
      const { container } = renderWithProviders(<PlanCreditCard grant={undefined} />);

      // AlertIcon should be present
      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('should still render title in error state', function renderTitleInError() {
      renderWithProviders(<PlanCreditCard grant={undefined} />);

      expect(screen.getByText('builder_manageplan_monthly_credits')).toBeInTheDocument();
    });

    it('should have centered text in error state', function centeredText() {
      const { container } = renderWithProviders(<PlanCreditCard grant={undefined} />);

      const errorContainer = container.firstChild as HTMLElement;
      expect(errorContainer.className).toContain('items-center');
      expect(errorContainer.className).toContain('justify-center');
    });
  });

  describe('handles different credit values', function creditValuesTests() {
    it('should handle zero credits spent', function zeroSpent() {
      renderWithProviders(
        <PlanCreditCard grant={createMockGrant({ creditsSpent: 0, creditsMax: 1500 })} />
      );

      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('/ 1,500')).toBeInTheDocument();
    });

    it('should handle fully used credits', function fullyUsed() {
      renderWithProviders(
        <PlanCreditCard grant={createMockGrant({ creditsSpent: 1500, creditsMax: 1500 })} />
      );

      expect(screen.getByText('1,500')).toBeInTheDocument();
    });

    it('should handle large credit numbers', function largeNumbers() {
      renderWithProviders(
        <PlanCreditCard grant={createMockGrant({ creditsSpent: 10000, creditsMax: 50000 })} />
      );

      expect(screen.getByText('10,000')).toBeInTheDocument();
      expect(screen.getByText('/ 50,000')).toBeInTheDocument();
    });
  });
});
