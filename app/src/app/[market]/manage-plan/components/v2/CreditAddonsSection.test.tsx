/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { PAYWALL_ITC,PAYWALL_TYPE } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantFinalState, GrantType } from '@/types/credits';
import CreditAddonsSection from './CreditAddonsSection';

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

vi.mock('@/hooks/useSubscriptionWithPolling', () => ({
  useSubscriptionWithPolling: () => ({
    builderEntitlementId: 'ent-1',
  }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (event: string) { return `${event}.click`; }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    span: ({ children, ...props }: { children: React.ReactNode; className?: string }) =>
      <span {...props}>{children}</span>,
  },
}));

vi.mock('@ux/icon/chevron-down', () => ({
  default: () => <span data-testid="chevron-down" />,
}));

vi.mock('@ux/icon/chevron-up', () => ({
  default: () => <span data-testid="chevron-up" />,
}));

function createMockGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'grant-1',
    subscriptionId: 'sub-1',
    type: GrantType.CreditPack,
    llmBudgetUserId: 'user-1',
    llmBudgetId: 'budget-1',
    creditsMax: 5000,
    creditsSpent: 2000,
    isAvailable: true,
    finalState: null,
    useBefore: '2027-12-31T00:00:00.000Z',
    consumedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const defaultProps = {
  activePacks: [createMockGrant()],
  usedExpiredPacks: [],
  activeGrantId: 'grant-1',
  locale: 'en-US',
  openPaywall: vi.fn(),
};

describe('CreditAddonsSection', function creditAddonsSectionTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('empty state', function emptyStateTests() {
    it('should render empty state when no packs exist', function rendersEmptyState() {
      renderWithProviders(
        <CreditAddonsSection
          {...defaultProps}
          activePacks={[]}
          usedExpiredPacks={[]}
        />
      );

      expect(screen.getByText('builder_manageplan_creditpacks_title')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_creditpacks_empty_description')).toBeInTheDocument();
    });

    it('should render buy credits button in empty state', function rendersBuyButton() {
      renderWithProviders(
        <CreditAddonsSection
          {...defaultProps}
          activePacks={[]}
          usedExpiredPacks={[]}
        />
      );

      expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
    });

    it('should call openPaywall when buy credits is clicked', function callsOpenPaywall() {
      const openPaywall = vi.fn();
      renderWithProviders(
        <CreditAddonsSection
          {...defaultProps}
          activePacks={[]}
          usedExpiredPacks={[]}
          openPaywall={openPaywall}
        />
      );

      fireEvent.click(screen.getByText('builder_manageplan_buy_credits'));

      expect(openPaywall).toHaveBeenCalledWith(
        'manage_plan.addons.buy_credits',
        PAYWALL_TYPE.CREDITS,
        PAYWALL_ITC.CREDITS,
      );
    });
  });

  describe('renders with active packs', function activePacksTests() {
    it('should render the section title', function rendersSectionTitle() {
      renderWithProviders(<CreditAddonsSection {...defaultProps} />);

      expect(screen.getByText('builder_manageplan_creditpacks_title')).toBeInTheDocument();
    });

    it('should render active pack grant rows', function rendersActiveGrants() {
      renderWithProviders(<CreditAddonsSection {...defaultProps} />);

      expect(screen.getAllByText('builder_manageplan_pack').length).toBeGreaterThan(0);
    });

    it('should render aggregate progress bar when active packs exist', function rendersAggregateProgressBar() {
      const { container } = renderWithProviders(<CreditAddonsSection {...defaultProps} />);

      expect(container.querySelectorAll('[role="progressbar"]').length).toBeGreaterThan(0);
    });

    it('should render the active packs summary label', function rendersActivePacksSummary() {
      renderWithProviders(<CreditAddonsSection {...defaultProps} />);

      expect(screen.getByText(/builder_manageplan_active_packs_summary/)).toBeInTheDocument();
    });
  });

  describe('collapse toggle', function collapseToggleTests() {
    it('should toggle collapse when header button is clicked', function togglesCollapse() {
      renderWithProviders(<CreditAddonsSection {...defaultProps} />);

      const collapseButton = screen.getByRole('button', { name: /builder_common_collapse/i });
      expect(collapseButton).toHaveAttribute('aria-expanded', 'true');

      fireEvent.click(collapseButton);

      expect(collapseButton).toHaveAttribute('aria-expanded', 'false');
    });

    it('should expand when collapsed header is clicked', function expandsOnClick() {
      renderWithProviders(<CreditAddonsSection {...defaultProps} />);

      const collapseButton = screen.getByRole('button', { name: /builder_common_collapse/i });
      fireEvent.click(collapseButton);
      expect(collapseButton).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(collapseButton);
      expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('used/expired packs', function usedExpiredPacksTests() {
    const usedGrant: CreditGrant = createMockGrant({
      id: 'used-grant',
      isAvailable: false,
      finalState: GrantFinalState.Consumed,
      creditsSpent: 5000,
    });

    it('should show toggle button when used/expired packs exist', function showsToggleButton() {
      renderWithProviders(
        <CreditAddonsSection
          {...defaultProps}
          usedExpiredPacks={[usedGrant]}
        />
      );

      expect(screen.getByText('builder_manageplan_show_used_expired')).toBeInTheDocument();
    });

    it('should not show toggle button when no used/expired packs', function hidesToggleButton() {
      renderWithProviders(<CreditAddonsSection {...defaultProps} usedExpiredPacks={[]} />);

      expect(screen.queryByText('builder_manageplan_show_used_expired')).not.toBeInTheDocument();
    });

    it('should expand used/expired section when toggle is clicked', function expandsUsedExpired() {
      renderWithProviders(
        <CreditAddonsSection
          {...defaultProps}
          usedExpiredPacks={[usedGrant]}
        />
      );

      const toggleButton = screen.getByText('builder_manageplan_show_used_expired').closest('button');
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(toggleButton!);

      expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('builder_manageplan_hide_used_expired')).toBeInTheDocument();
    });

    it('should collapse used/expired section when toggle is clicked again', function collapsesUsedExpired() {
      renderWithProviders(
        <CreditAddonsSection
          {...defaultProps}
          usedExpiredPacks={[usedGrant]}
        />
      );

      const toggleButton = screen.getByText('builder_manageplan_show_used_expired').closest('button');
      fireEvent.click(toggleButton!);

      const hideButton = screen.getByText('builder_manageplan_hide_used_expired').closest('button');
      fireEvent.click(hideButton!);

      expect(screen.getByText('builder_manageplan_show_used_expired')).toBeInTheDocument();
    });
  });

  describe('multiple active packs', function multipleActivePacksTests() {
    it('should render all active pack rows', function rendersAllActivePacks() {
      const packs: CreditGrant[] = [
        createMockGrant({ id: 'grant-1' }),
        createMockGrant({ id: 'grant-2', creditsMax: 10000, creditsSpent: 3000 }),
      ];

      renderWithProviders(
        <CreditAddonsSection
          {...defaultProps}
          activePacks={packs}
        />
      );

      expect(screen.getAllByText('builder_manageplan_pack').length).toBe(2);
    });
  });
});
