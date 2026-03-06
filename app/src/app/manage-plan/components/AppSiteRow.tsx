import Button from '@ux/button';
import Tag from '@ux/tag';
import text from '@ux/text';

import AppThumbnail from '@/app/apps/AppThumbnail';
import { useTranslations } from '@/hooks/useTranslations';
import { PAYWALL_ITC, type PaywallType } from '@/lib/paywall/shared';
import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';
import { generateClickEID } from '@/utils/instrumentation';

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
  onPublishClick: (siteId: string) => void;
  onUnpublishClick: (site: SiteInfo) => void;
  onOpenPaywall?: (source: string, type?: PaywallType, itc?: string) => void;
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
  onPublishClick,
  onUnpublishClick,
  onOpenPaywall,
}: AppSiteRowProps) {
  const t = useTranslations();

  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 min-w-0">
        <AppThumbnail siteId={site.id} siteName={site.name} size="md" />
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
            >
              {publishedUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 ml-2">
        {isDisconnectingDomain ? (
          <Button
            design="secondary"
            disabled={true}
            size="sm"
            data-partial="componentAiro"
            text={t('builder_unpublish_disconnecting_domain')}
          />
        ) : isPublished && isUnpublishEnabled ? (
          <Button
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
        ) : !isPublished && !isPaidPlan && onOpenPaywall ? (
          <Button
            design="primary"
            size="sm"
            data-partial="componentAiro"
            data-eid={generateClickEID('manageplan.buttons.upgrade_to_publish')}
            text={t('builder_manageplan_apps_upgrade_to_publish')}
            onClick={() => onOpenPaywall('manage_plan.upgrade_to_publish', 'upgrade', PAYWALL_ITC.UPGRADE)}
          />
        ) : !isPublished ? (
          <Button
            design="primary"
            size="sm"
            disabled={disabled}
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
      </div>
    </div>
  );
}
