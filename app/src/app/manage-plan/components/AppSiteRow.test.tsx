/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import type { SiteInfo } from '@/lib/control-plane/types';
import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((event: string) => `appbuilder.${event}.click`),
  logClickEvent: vi.fn(() => vi.fn()),
}));

import AppSiteRow from './AppSiteRow';

const createMockSite = (overrides: Partial<SiteInfo> = {}): SiteInfo => ({
  id: 'site-123',
  name: 'Test App',
  status: 'running',
  account_id: 'account-123',
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('AppSiteRow', function appSiteRowTests() {
  const defaultProps = {
    disabled: false,
    site: createMockSite(),
    isPublished: false,
    publishedUrl: null,
    isPublishing: false,
    isUnpublishing: false,
    isDisconnectingDomain: false,
    isUnpublishEnabled: true,
    isPaidPlan: true,
    isAtPublishLimit: false,
    canUpgrade: true,
    isPublishingBlocked: false,
    onPublishClick: vi.fn(),
    onUnpublishClick: vi.fn(),
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render site name', function renderSiteName() {
      renderWithProviders(<AppSiteRow {...defaultProps} />);

      expect(screen.getByText('Test App')).toBeInTheDocument();
    });

    it('should render Published tag when isPublished is true', function renderPublishedTag() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={true} />
      );

      expect(screen.getByText('builder_manageplan_apps_published')).toBeInTheDocument();
    });

    it('should not render Published tag when isPublished is false', function noPublishedTag() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={false} />
      );

      expect(screen.queryByText('builder_manageplan_apps_published')).not.toBeInTheDocument();
    });

    it('should render published URL as link when available', function renderPublishedUrl() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={true}
          publishedUrl="https://example.com"
        />
      );

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveTextContent('example.com');
    });

    it('should strip protocol from published URL display', function stripProtocol() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={true}
          publishedUrl="https://www.example.com/path"
        />
      );

      expect(screen.getByText('www.example.com/path')).toBeInTheDocument();
    });
  });

  describe('unpublish button', function unpublishButtonTests() {
    it('should render Unpublish button for published sites', function renderUnpublishButton() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={true} isUnpublishEnabled={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_unpublish' })).toBeInTheDocument();
    });

    it('should not render Unpublish button when unpublish is disabled', function noUnpublishWhenDisabled() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={true} isUnpublishEnabled={false} />
      );

      expect(screen.queryByRole('button', { name: 'builder_manageplan_apps_unpublish' })).not.toBeInTheDocument();
    });

    it('should render Unpublish when inactive publish but unpublishAvailable is true', function unpublishWhenInactivePublish() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          unpublishAvailable={true}
          isUnpublishEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_apps_published')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_unpublish' })).toBeInTheDocument();
    });

    it('should call onUnpublishClick when Unpublish button is clicked', function callsOnUnpublish() {
      const onUnpublishClick = vi.fn();
      const site = createMockSite();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          site={site}
          isPublished={true}
          onUnpublishClick={onUnpublishClick}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'builder_manageplan_apps_unpublish' }));

      expect(onUnpublishClick).toHaveBeenCalledWith(site);
    });

    it('should show Unpublishing... text when isUnpublishing is true', function showsUnpublishingText() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={true} isUnpublishing={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_unpublish_processing' })).toBeInTheDocument();
    });

    it('should disable button when disabled prop is true while unpublishing', function disabledWhenUnpublishing() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={true} isUnpublishing={true} disabled={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_unpublish_processing' })).toBeDisabled();
    });
  });

  describe('publish button', function publishButtonTests() {
    it('should render Publish button for unpublished sites on paid plan', function renderPublishButton() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={false} isPaidPlan={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' })).toBeInTheDocument();
    });

    it('should call onPublishClick when Publish button is clicked', function callsOnPublish() {
      const onPublishClick = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          onPublishClick={onPublishClick}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' }));

      expect(onPublishClick).toHaveBeenCalledWith('site-123');
    });

    it('should show Publishing... text when isPublishing is true', function showsPublishingText() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={false} isPublishing={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_common_publishing' })).toBeInTheDocument();
    });

    it('should disable button when disabled prop is true while publishing', function disabledWhenPublishing() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={false} isPublishing={true} disabled={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_common_publishing' })).toBeDisabled();
    });
  });

  describe('upgrade to publish button', function upgradeButtonTests() {
    it('should render Upgrade to Publish button for free users', function renderUpgradeButton() {
      const onOpenPaywall = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isPaidPlan={false}
          onOpenPaywall={onOpenPaywall}
        />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_upgrade_to_publish' })).toBeInTheDocument();
    });

    it('should call onOpenPaywall when Upgrade to Publish is clicked', function callsOnOpenPaywall() {
      const onOpenPaywall = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isPaidPlan={false}
          onOpenPaywall={onOpenPaywall}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'builder_manageplan_apps_upgrade_to_publish' }));

      expect(onOpenPaywall).toHaveBeenCalledWith(
        'manage_plan.upgrade_to_publish',
        'upgrade',
        expect.any(String)
      );
    });

    it('should not render Upgrade button when no onOpenPaywall provided', function noUpgradeWithoutPaywall() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isPaidPlan={false}
          onOpenPaywall={undefined}
        />
      );

      expect(screen.queryByRole('button', { name: 'builder_manageplan_apps_upgrade_to_publish' })).not.toBeInTheDocument();
    });

    it('should disable Upgrade to Publish button for free users when disabled prop is true', function disablesUpgradeForFreeUser() {
      const onOpenPaywall = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          disabled={true}
          isPublished={false}
          isPaidPlan={false}
          onOpenPaywall={onOpenPaywall}
        />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_upgrade_to_publish' })).toBeDisabled();
    });

    it('should render Upgrade to Publish button for paid users at publish limit who can upgrade', function renderUpgradeAtLimit() {
      const onOpenPaywall = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isPaidPlan={true}
          isAtPublishLimit={true}
          canUpgrade={true}
          onOpenPaywall={onOpenPaywall}
        />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_upgrade_to_publish' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'builder_manageplan_apps_publish' })).not.toBeInTheDocument();
    });

    it('should disable Upgrade to Publish button when disabled prop is true', function disablesUpgradeButton() {
      const onOpenPaywall = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          disabled={true}
          isPublished={false}
          isPaidPlan={true}
          isAtPublishLimit={true}
          canUpgrade={true}
          onOpenPaywall={onOpenPaywall}
        />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_upgrade_to_publish' })).toBeDisabled();
    });

    it('should show disabled Publish button for Ultimate users at publish limit', function disabledPublishForUltimate() {
      const onOpenPaywall = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isPaidPlan={true}
          isAtPublishLimit={true}
          canUpgrade={false}
          onOpenPaywall={onOpenPaywall}
        />
      );

      // Should show Publish button, not Upgrade
      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'builder_manageplan_apps_upgrade_to_publish' })).not.toBeInTheDocument();
    });
  });

  describe('disconnecting domain state', function disconnectingDomainTests() {
    it('should render Disconnecting Domain... button when isDisconnectingDomain', function renderDisconnectingState() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isDisconnectingDomain={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_unpublish_disconnecting_domain' })).toBeInTheDocument();
    });

    it('should disable button when disconnecting domain', function disabledWhenDisconnecting() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isDisconnectingDomain={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_unpublish_disconnecting_domain' })).toBeDisabled();
    });

    it('should prioritize disconnecting domain state over other states', function prioritizesDisconnecting() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isDisconnectingDomain={true}
          isPublished={true}
          isUnpublishing={true}
        />
      );

      // Should show disconnecting, not unpublishing
      expect(screen.getByRole('button', { name: 'builder_unpublish_disconnecting_domain' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'builder_unpublish_processing' })).not.toBeInTheDocument();
    });
  });

  describe('disabled state', function disabledStateTests() {
    it('should disable publish button when disabled prop is true', function disablesPublish() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} disabled={true} isPublished={false} />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' })).toBeDisabled();
    });

    it('should disable unpublish button when disabled prop is true', function disablesUnpublish() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} disabled={true} isPublished={true} />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_unpublish' })).toBeDisabled();
    });
  });

  describe('data attributes', function dataAttributeTests() {
    it('should have data-eid attribute on publish button', function hasDataEidPublish() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={false} />
      );

      const button = screen.getByRole('button', { name: 'builder_manageplan_apps_publish' });
      expect(button).toHaveAttribute('data-eid');
    });

    it('should have data-eid attribute on unpublish button', function hasDataEidUnpublish() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={true} />
      );

      const button = screen.getByRole('button', { name: 'builder_manageplan_apps_unpublish' });
      expect(button).toHaveAttribute('data-eid');
    });

    it('should have data-partial attribute on buttons', function hasDataPartial() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={false} />
      );

      const button = screen.getByRole('button', { name: 'builder_manageplan_apps_publish' });
      expect(button).toHaveAttribute('data-partial', 'componentAiro');
    });
  });

  describe('row click navigation', function rowClickTests() {
    it('should call onRowClick with site id when row is clicked', function callsOnRowClick() {
      const onRowClick = vi.fn();
      renderWithProviders(
        <AppSiteRow {...defaultProps} onRowClick={onRowClick} />
      );

      fireEvent.click(screen.getByText('Test App'));

      expect(onRowClick).toHaveBeenCalledWith('site-123');
    });

    it('should not call onRowClick when published URL link is clicked', function linkDoesNotTriggerRowClick() {
      const onRowClick = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={true}
          publishedUrl="https://example.com"
          onRowClick={onRowClick}
        />
      );

      fireEvent.click(screen.getByRole('link'));

      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('should not call onRowClick when action button is clicked', function buttonDoesNotTriggerRowClick() {
      const onRowClick = vi.fn();
      const onPublishClick = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          onRowClick={onRowClick}
          onPublishClick={onPublishClick}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' }));

      expect(onPublishClick).toHaveBeenCalledWith('site-123');
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('should call onRowClick when Enter is pressed on the row', function enterActivatesRow() {
      const onRowClick = vi.fn();
      renderWithProviders(
        <AppSiteRow {...defaultProps} onRowClick={onRowClick} />
      );

      fireEvent.keyDown(screen.getByRole('button', { name: /Test App/i }), { key: 'Enter' });

      expect(onRowClick).toHaveBeenCalledWith('site-123');
    });

    it('should call onRowClick when Space is pressed on the row', function spaceActivatesRow() {
      const onRowClick = vi.fn();
      renderWithProviders(
        <AppSiteRow {...defaultProps} onRowClick={onRowClick} />
      );

      const row = screen.getByRole('button', { name: /Test App/i });
      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      row.dispatchEvent(event);

      expect(onRowClick).toHaveBeenCalledWith('site-123');
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should not call onRowClick when Enter is pressed on a nested button', function enterOnNestedButton() {
      const onRowClick = vi.fn();
      const onPublishClick = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          onRowClick={onRowClick}
          onPublishClick={onPublishClick}
        />
      );

      fireEvent.keyDown(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' }), { key: 'Enter' });

      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('should not call onRowClick when Enter is pressed on the published URL link', function enterOnLink() {
      const onRowClick = vi.fn();
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={true}
          publishedUrl="https://example.com"
          onRowClick={onRowClick}
        />
      );

      fireEvent.keyDown(screen.getByRole('link'), { key: 'Enter' });

      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('should not render role="button" when onRowClick is not provided', function noRoleWithoutCallback() {
      const { container } = renderWithProviders(
        <AppSiteRow {...defaultProps} onRowClick={undefined} />
      );

      expect(container.querySelector('[role="button"]')).not.toBeInTheDocument();
    });
  });

  describe('error display', function errorDisplayTests() {
    it('should render error message when error prop is provided', function rendersError() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} error="Something went wrong" />
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('should not render error message when error prop is undefined', function noErrorWhenUndefined() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} error={undefined} />
      );

      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('should render error message alongside publish button', function errorWithPublishButton() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={false} error="Publish failed" />
      );

      expect(screen.getByText('Publish failed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' })).toBeInTheDocument();
    });

    it('should render error message alongside unpublish button', function errorWithUnpublishButton() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={true} error="Unpublish failed" />
      );

      expect(screen.getByText('Unpublish failed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_unpublish' })).toBeInTheDocument();
    });

    it('should not disable button when error is displayed', function buttonEnabledWithError() {
      renderWithProviders(
        <AppSiteRow {...defaultProps} isPublished={false} error="Previous attempt failed" />
      );

      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' })).not.toBeDisabled();
    });
  });

  describe('publishing blocked', function publishingBlockedTests() {
    it('should disable publish button when isPublishingBlocked is true', function publishButtonDisabledWhenBlocked() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isPublishingBlocked={true}
        />
      );

      const publishButton = screen.getByRole('button', { name: 'builder_manageplan_apps_publish' });
      expect(publishButton).toBeDisabled();
    });

    it('should enable publish button when isPublishingBlocked is false', function publishButtonEnabledWhenNotBlocked() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isPublishingBlocked={false}
        />
      );

      const publishButton = screen.getByRole('button', { name: 'builder_manageplan_apps_publish' });
      expect(publishButton).not.toBeDisabled();
    });

    it('should disable publish button when both isAtPublishLimit and isPublishingBlocked are true', function publishButtonDisabledWithBothConditions() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isAtPublishLimit={true}
          isPublishingBlocked={true}
        />
      );

      const publishButton = screen.getByRole('button', { name: 'builder_manageplan_apps_publish' });
      expect(publishButton).toBeDisabled();
    });

    it('should show disabled Publish instead of Upgrade when publishing is blocked for a free user', function blockedOverridesUpgrade() {
      renderWithProviders(
        <AppSiteRow
          {...defaultProps}
          isPublished={false}
          isPaidPlan={false}
          isPublishingBlocked={true}
          onOpenPaywall={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: 'builder_manageplan_apps_upgrade_to_publish' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'builder_manageplan_apps_publish' })).toBeDisabled();
    });
  });
});
