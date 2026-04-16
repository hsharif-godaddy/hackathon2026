/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import type { SiteInfo } from '@/lib/control-plane/types';
import { renderWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import PublishLimitModal from './PublishLimitModal';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (params) {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((event: string) => `appbuilder.${event}.click`),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('react-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-intl')>();
  return {
    ...actual,
    FormattedMessage: ({
      id,
      values,
    }: {
      id: string;
      values?: Record<string, (chunks: string) => React.ReactNode>;
    }) => {
      if (values?.myAppsLink) {
        return (
          <span>
            {id}
            {values.myAppsLink('My Apps')}
          </span>
        );
      }
      return <span>{id}</span>;
    },
  };
});

const mockUseSwitchboard = vi.fn();

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}));

vi.mock('@ux/modal', () => ({
  default: ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button onClick={onClose} aria-label="Close">Close</button>
      <div>{children}</div>
    </div>
  ),
}));

const createMockSite = (overrides: Partial<SiteInfo> = {}): SiteInfo => ({
  id: 'site-123',
  name: 'Test App',
  status: 'running',
  account_id: 'account-123',
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

vi.mock('@/utils/credits', () => ({
  getPlanDisplayLabelKey: vi.fn((plan: string) => `builder_manageplan_plan_${plan}`),
}));

describe('PublishLimitModal', function publishLimitModalTests() {
  const defaultProps = {
    plan: SubscriptionPlan.Starter,
    currentCount: 3,
    limit: 3,
    publishedApps: [
      createMockSite({ id: 'app-1', name: 'App One' }),
      createMockSite({ id: 'app-2', name: 'App Two' }),
      createMockSite({ id: 'app-3', name: 'App Three' }),
    ],
    onClose: vi.fn(),
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
    // Default: both flags disabled
    mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false });
  });

  describe('renders correctly', function renderTests() {
    it('should render the modal', function renderModal() {
      renderWithProviders(<PublishLimitModal {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render the modal title', function renderTitle() {
      renderWithProviders(<PublishLimitModal {...defaultProps} />);

      expect(screen.getByRole('heading', { name: 'builder_publish_limit_title' })).toBeInTheDocument();
    });

    it('should render list of published apps', function renderAppsList() {
      renderWithProviders(<PublishLimitModal {...defaultProps} />);

      expect(screen.getByText('App One')).toBeInTheDocument();
      expect(screen.getByText('App Two')).toBeInTheDocument();
      expect(screen.getByText('App Three')).toBeInTheDocument();
    });

    it('should render apps published header', function renderAppsHeader() {
      renderWithProviders(<PublishLimitModal {...defaultProps} />);

      expect(screen.getByText('builder_publish_limit_apps_published')).toBeInTheDocument();
    });

    it('should not render apps list when publishedApps is empty', function noAppsListWhenEmpty() {
      renderWithProviders(
        <PublishLimitModal {...defaultProps} publishedApps={[]} currentCount={0} />
      );

      expect(screen.queryByText('builder_publish_limit_apps_published')).not.toBeInTheDocument();
    });

    it('should show no apps found message when currentCount > 0 but list is empty', function showsNoAppsMessage() {
      renderWithProviders(
        <PublishLimitModal {...defaultProps} publishedApps={[]} currentCount={3} />
      );

      expect(screen.getByText('builder_publish_limit_no_apps_found')).toBeInTheDocument();
    });
  });

  describe('upgrade and manage buttons', function upgradeAndManageButtonsTests() {
    beforeEach(function setup() {
      mockUseSwitchboard.mockImplementation((flag: string) => {
        if (flag === 'appbuilder-unpublish') return { data: true, isLoading: false };
        return { data: false, isLoading: false };
      });
    });

    it('should show Upgrade button for non-Ultimate users', function showsUpgradeButton() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Starter}
          onUpgrade={onUpgrade}
        />
      );

      expect(screen.getByRole('button', { name: 'builder_publish_limit_upgrade' })).toBeInTheDocument();
    });

    it('should not show Upgrade button for Ultimate users', function noUpgradeForUltimate() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Ultimate}
          onUpgrade={onUpgrade}
        />
      );

      expect(screen.queryByRole('button', { name: 'builder_publish_limit_upgrade' })).not.toBeInTheDocument();
    });

    it('should not show Upgrade button when onUpgrade is not provided', function noUpgradeWithoutCallback() {
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Starter}
          onUpgrade={undefined}
        />
      );

      expect(screen.queryByRole('button', { name: 'builder_publish_limit_upgrade' })).not.toBeInTheDocument();
    });

    it('should call onUpgrade and onClose when Upgrade is clicked', function callsOnUpgrade() {
      const onUpgrade = vi.fn();
      const onClose = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Starter}
          onUpgrade={onUpgrade}
          onClose={onClose}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'builder_publish_limit_upgrade' }));

      expect(onClose).toHaveBeenCalled();
      expect(onUpgrade).toHaveBeenCalled();
    });

    it('should not show Manage Published Apps button when Upgrade is shown', function noManageAppsWhenUpgrade() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Starter}
          onUpgrade={onUpgrade}
        />
      );

      expect(screen.queryByRole('button', { name: 'builder_publish_limit_manage_apps' })).not.toBeInTheDocument();
    });

    it('should show plan info text when higher plans enabled', function showsPlanInfo() {
      renderWithProviders(
        <PublishLimitModal {...defaultProps} onUpgrade={vi.fn()} />
      );

      // Translation mock returns key:params format
      expect(screen.getByText(/builder_publish_limit_plan_info/)).toBeInTheDocument();
    });

    it('should show upgrade hint with My Apps link', function showsUpgradeHint() {
      renderWithProviders(
        <PublishLimitModal {...defaultProps} onUpgrade={vi.fn()} />
      );

      expect(screen.getByText('builder_publish_limit_upgrade_hint')).toBeInTheDocument();
    });

    it('should navigate to manage-plan when My Apps link in upgrade hint is clicked', function navigatesFromUpgradeHint() {
      const onClose = vi.fn();
      renderWithProviders(
        <PublishLimitModal {...defaultProps} onClose={onClose} onUpgrade={vi.fn()} />
      );

      const myAppsButton = screen.getByRole('button', { name: 'My Apps' });
      fireEvent.click(myAppsButton);

      expect(onClose).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/manage-plan');
    });
  });

  describe('modal interactions', function interactionTests() {
    it('should call onClose when close button is clicked', function callsOnClose() {
      const onClose = vi.fn();
      renderWithProviders(<PublishLimitModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('different plan types', function planTypeTests() {
    beforeEach(function setup() {
      mockUseSwitchboard.mockImplementation(() => ({ data: false, isLoading: false }));
    });

    it('should show Upgrade for Free plan', function upgradeForFree() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Free}
          onUpgrade={onUpgrade}
        />
      );

      expect(screen.getByRole('button', { name: 'builder_publish_limit_upgrade' })).toBeInTheDocument();
    });

    it('should show Upgrade for Starter plan', function upgradeForStarter() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Starter}
          onUpgrade={onUpgrade}
        />
      );

      expect(screen.getByRole('button', { name: 'builder_publish_limit_upgrade' })).toBeInTheDocument();
    });

    it('should show Upgrade for Professional plan', function upgradeForProfessional() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Professional}
          onUpgrade={onUpgrade}
        />
      );

      expect(screen.getByRole('button', { name: 'builder_publish_limit_upgrade' })).toBeInTheDocument();
    });

    it('should not show Upgrade for Ultimate plan', function noUpgradeForUltimate() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Ultimate}
          onUpgrade={onUpgrade}
        />
      );

      expect(screen.queryByRole('button', { name: 'builder_publish_limit_upgrade' })).not.toBeInTheDocument();
    });
  });

  describe('data attributes', function dataAttributeTests() {
    beforeEach(function setup() {
      mockUseSwitchboard.mockImplementation(() => ({ data: false, isLoading: false }));
    });

    it('should have data-eid attribute on Upgrade button', function hasDataEidUpgrade() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Starter}
          onUpgrade={onUpgrade}
        />
      );

      const button = screen.getByRole('button', { name: 'builder_publish_limit_upgrade' });
      expect(button).toHaveAttribute('data-eid');
    });

    it('should have data-partial attribute on Upgrade button', function hasDataPartialUpgrade() {
      const onUpgrade = vi.fn();
      renderWithProviders(
        <PublishLimitModal
          {...defaultProps}
          plan={SubscriptionPlan.Starter}
          onUpgrade={onUpgrade}
        />
      );

      const button = screen.getByRole('button', { name: 'builder_publish_limit_upgrade' });
      expect(button).toHaveAttribute('data-partial', 'componentAiro');
    });
  });
});
