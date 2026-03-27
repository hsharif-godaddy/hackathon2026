/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { LegacyPopoverContent } from './LegacyPopoverContent';

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((eid: string) => `appbuilder.${eid}.click`),
}));

const defaultProps = {
  percentage: 65,
  translatedResetTime: 'tomorrow at 4:10 PM',
  purchaseEnabled: true,
  onUpgradeClick: vi.fn(),
  onBuyTokensClick: vi.fn(),
};

describe('LegacyPopoverContent', function legacyPopoverContentTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render daily usage title', function renderTitle() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} />);

      expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
    });

    it('should render usage summary with percentage', function renderUsageSummary() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} percentage={75} />);

      // The FormattedMessage will render the translation key
      expect(screen.getByText(/builder_usage_summary/)).toBeInTheDocument();
    });

    it('should render upgrade button when purchase enabled', function renderUpgradeButton() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} purchaseEnabled={true} />);

      expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
    });

    it('should render buy tokens button when purchase enabled', function renderBuyTokensButton() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} purchaseEnabled={true} />);

      expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
    });

    it('should not render buttons when purchase disabled', function noButtonsWhenDisabled() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} purchaseEnabled={false} />);

      expect(screen.queryByText('builder_usage_gauge_upgrade')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_usage_gauge_buy_tokens')).not.toBeInTheDocument();
    });
  });

  describe('button interactions', function buttonInteractionTests() {
    it('should call onUpgradeClick when upgrade button is clicked', async function clickUpgrade() {
      const onUpgradeClick = vi.fn();
      const { user } = renderWithProviders(
        <LegacyPopoverContent {...defaultProps} onUpgradeClick={onUpgradeClick} />
      );

      await user.click(screen.getByText('builder_usage_gauge_upgrade'));

      expect(onUpgradeClick).toHaveBeenCalledTimes(1);
    });

    it('should call onBuyTokensClick when buy tokens button is clicked', async function clickBuyTokens() {
      const onBuyTokensClick = vi.fn();
      const { user } = renderWithProviders(
        <LegacyPopoverContent {...defaultProps} onBuyTokensClick={onBuyTokensClick} />
      );

      await user.click(screen.getByText('builder_usage_gauge_buy_tokens'));

      expect(onBuyTokensClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('button styles', function buttonStyleTests() {
    it('should render upgrade button as primary', function upgradeButtonPrimary() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} />);

      const upgradeButton = screen.getByText('builder_usage_gauge_upgrade').closest('button');
      expect(upgradeButton).toHaveClass('ux-button-primary');
    });

    it('should render buy tokens button as secondary', function buyTokensButtonSecondary() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} />);

      const buyTokensButton = screen.getByText('builder_usage_gauge_buy_tokens').closest('button');
      expect(buyTokensButton).toHaveClass('ux-button-secondary');
    });
  });

  describe('EIDs', function eidTests() {
    it('should have correct EID on upgrade button', function upgradeButtonEID() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} />);

      const upgradeButton = screen.getByText('builder_usage_gauge_upgrade').closest('button');
      expect(upgradeButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.upgrade_legacy.click');
    });

    it('should have correct EID on buy tokens button', function buyTokensButtonEID() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} />);

      const buyTokensButton = screen.getByText('builder_usage_gauge_buy_tokens').closest('button');
      expect(buyTokensButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.buy_tokens_legacy.click');
    });
  });

  describe('edge cases', function edgeCaseTests() {
    it('should handle zero percentage', function handleZeroPercentage() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} percentage={0} />);

      expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
    });

    it('should handle 100 percentage', function handleFullPercentage() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} percentage={100} />);

      expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
    });

    it('should handle null translatedResetTime', function handleNullResetTime() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} translatedResetTime={null} />);

      expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
    });

    it('should handle percentage greater than 100', function handleOverPercentage() {
      renderWithProviders(<LegacyPopoverContent {...defaultProps} percentage={150} />);

      expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
    });
  });
});
