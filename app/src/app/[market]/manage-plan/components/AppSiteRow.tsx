import clsx from 'clsx';
import Button from '@ux/button';
import Tag from '@ux/tag';
import text from '@ux/text';

import AppThumbnail from '@/app/[market]/apps/AppThumbnail';
import { useTranslations } from '@/hooks/useTranslations';
import type { SiteInfo } from '@/lib/control-plane/types';
import { PAYWALL_ITC, type PaywallType } from '@/lib/paywall/shared';
import { generateClickEID, logClickEvent } from '@/utils/instrumentation';

interface AppSiteRowProps {
  disabled: boolean;
  site: SiteInfo;
  isPublished: boolean;
  publishedUrl: string | null;
  isPublishing: boolean;
  isUnpublishing: boolean;
  isDisconnectingDomain: boolean;
  isUnpublishEnabled: boolean;
  isPaidPlan: boolean;
  isAtPublishLimit: boolean;
  canUpgrade: boolean;
  /** When true, publishing is blocked due to suspension */
  isPublishingBlocked?: boolean;
  error?: string;
  onPublishClick: (siteId: string) => void;
  onUnpublishClick: (site: SiteInfo) => void;
  onOpenPaywall?: (source: string, type?: PaywallType, itc?: string) => void;
  onRowClick?: (siteId: string) => void;
}

/**
 * Single row component for displaying an app/site in the AppsAndSitesCard
 */
export default function AppSiteRow({
  disabled,
  site,
  isPublished,
  publishedUrl,
  isPublishing,
  isUnpublishing,
  isDisconnectingDomain,
  isUnpublishEnabled,
  isPaidPlan,
  isAtPublishLimit,
  canUpgrade,
  isPublishingBlocked = false,
  error,
  onPublishClick,
  onUnpublishClick,
  onOpenPaywall,
  onRowClick,
}: AppSiteRowProps) {
  const t = useTranslations();
  const showUnpublishAction = isPublished && isUnpublishEnabled;

  return (
    <div
      role={onRowClick ? 'button' : undefined}
      tabIndex={onRowClick ? 0 : undefined}
      onClick={onRowClick ? () => {
        logClickEvent('manageplan.apps.row_click')();
        onRowClick(site.id);
      } : undefined}
      onKeyDown={onRowClick ? (e) => {
        if (e.currentTarget !== e.target) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          logClickEvent('manageplan.apps.row_click')();
          onRowClick(site.id);
        }
      } : undefined}
      className={clsx(
        'flex flex-col md:flex-row md:items-center md:justify-between gap-2 py-2 px-2 border-b border-border last:border-b-0',
        onRowClick && 'cursor-pointer rounded-sm transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor',
        error && 'pb-4 md:pb-2'
      )}
    >
      <div className="flex items-center gap-3 min-w-0 w-full md:w-auto">
        <AppThumbnail siteId={site.id} siteName={site.name} size="md" agentUrl={site.agent_url} />
        <div className="flex flex-col min-w-0">
          <div className="flex flex-col-reverse md:flex-row md:items-center flex-shrink-0 gap-2">
            <text.p className="truncate font-medium" title={site.name}>
              {site.name}
            </text.p>
            {isPublished && (
              <Tag className="!bg-ai-light/15 self-start">
                {t('builder_manageplan_apps_published')}
              </Tag>
            )}
          </div>
          {isPublished && publishedUrl && (
            <a
              href={publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-partial="componentAiro"
              className="text-sm text-link hover:underline hover:text-ai-light truncate block"
              onClick={(e) => e.stopPropagation()}
            >
              {publishedUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
      </div>

      <div
        className="relative flex flex-col w-full items-stretch ml-0 md:w-auto md:items-end md:flex-shrink-0 md:ml-2"
        onClick={(e) => e.stopPropagation()}
      >
        {isDisconnectingDomain ? (
          <Button
            className="w-full md:w-auto"
            design="secondary"
            disabled={true}
            size="sm"
            data-partial="componentAiro"
            text={t('builder_unpublish_disconnecting_domain')}
          />
        ) : showUnpublishAction ? (
          <Button
            className="w-full md:w-auto"
            design="secondary"
            disabled={disabled}
            size="sm"
            data-partial="componentAiro"
            data-eid={generateClickEID('manageplan.buttons.unpublish_app')}
            text={
              isUnpublishing
                ? t('builder_unpublish_processing')
                : t('builder_manageplan_apps_unpublish')
            }
            onClick={() => onUnpublishClick(site)}
          />
        ) : !isPublished && !isPublishingBlocked && (!isPaidPlan || (isAtPublishLimit && canUpgrade)) && onOpenPaywall ? (
          <Button
            className="w-full md:w-auto"
            design="primary"
            size="sm"
            disabled={disabled}
            data-partial="componentAiro"
            data-eid={generateClickEID('manageplan.buttons.upgrade_to_publish')}
            text={t('builder_manageplan_apps_upgrade_to_publish')}
            onClick={() => onOpenPaywall('manage_plan.upgrade_to_publish', 'upgrade', PAYWALL_ITC.UPGRADE)}
          />
        ) : !isPublished ? (
          <Button
            className="w-full md:w-auto"
            design="primary"
            size="sm"
            disabled={disabled || isAtPublishLimit || isPublishingBlocked}
            data-partial="componentAiro"
            data-eid={generateClickEID('manageplan.buttons.publish_app')}
            text={
              isPublishing
                ? t('builder_common_publishing')
                : t('builder_manageplan_apps_publish')
            }
            onClick={() => onPublishClick(site.id)}
          />
        ) : null}
        {error && (
          <text.p
            as="paragraph"
            size={-2}
            emphasis="critical"
            className="absolute top-full right-0 mt-1 text-right whitespace-normal w-20 md:w-48"
          >
            {error}
          </text.p>
        )}
      </div>
    </div>
  );
}
