import Box from "@ux/box";
import Button from "@ux/button";
import WebsiteIcon from '@ux/icon/website';
import text from "@ux/text";

import { SettingsLoadingState } from '@/app/develop/components/settings/components/SettingsLoadingState';
import DomainAttach from "@/app/develop/components/settings/DomainPanel/DomainAttach";
import ProjectDomain from "@/app/develop/components/settings/DomainPanel/ProjectDomain";
import { useAppIdFromParams } from "@/app/develop/components/utils";
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { useSwitchboard } from "@/hooks/useSwitchboard";
import { useTranslations } from '@/hooks/useTranslations';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { useDevelopPageStore } from "@/stores/useDevelopPageStore";
import { useSiteStore } from "@/stores/useSiteStore";
import RidingArrow from '@/svgs/riding-arrow';
import { generateClickEID } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';
import { usePublishForDomain } from './usePublishForDomain';

export default function DomainPanel() {
  const t = useTranslations();
  const { data: isDomainAttachEnabled, isLoading: isDomainAttachLoading } = useSwitchboard('appbuilder-domain-attach');
  const { data: isProjectDomainEnabled, isLoading: isProjectDomainLoading } = useSwitchboard('appbuilder-project-domain');

  const currentAppId = useAppIdFromParams();
  const site = useSiteStore((state) => {
    if (!currentAppId) {return null;}
    return state.getSite(currentAppId);
  });

  const isSiteLoading = useSiteStore((state) => {
    if (!currentAppId) {return false;}
    return state.loading[currentAppId] ?? false;
  });

  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(currentAppId || undefined);
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal);

  const { handlePublish, isPublishDisabled, publishState } = usePublishForDomain(currentAppId, site);
  const isPublished = hasBeenPublished(site);

  if (isDomainAttachLoading || isProjectDomainLoading || isSiteLoading || isPaywallLoading) {
    return (
      <SettingsLoadingState
        fullPage
        description={t('builder_common_loading_description')}
      />
    );
  }

  // Show upgrade screen for free users who haven't published
  if (!isSiteLoading && !isPublished && !isPaywallLoading && showPaywall && (isDomainAttachEnabled || isProjectDomainEnabled)) {
    return (
      <Box
        className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-6"
        orientation="horizontal"
        gap="lg"
        inlineAlignChildren="start"
        blockAlignChildren="center"
      >
        <Box orientation="vertical" gap="sm" className="flex-1">
          <text.h3 as="title">{t('builder_domain_upgrade_title')}</text.h3>
          <text.p className="text-intents-ux-text-secondaryColor">
            {t('builder_domain_upgrade_description')}
          </text.p>
          <div className="mt-2">
            <Button
              text={t('builder_upgrade_button')}
              design="primary"
              size="sm"
              onClick={() => openUpgradeModal('domains.upgrade', PAYWALL_ITC.UPGRADE)}
              data-eid={generateClickEID(`settings.domains.upgrade`)}
            />
          </div>
        </Box>
        <div className="flex-shrink-0">
          <RidingArrow />
        </div>
      </Box>
    );
  }

  // Show single empty state if site hasn't been published yet (for paid users)
  if (!isSiteLoading && !isPublished && (isDomainAttachEnabled || isProjectDomainEnabled)) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<WebsiteIcon width={48} height={48} />}
          title={t('builder_domain_publish_required_title')}
          description={t('builder_domain_publish_required_description')}
          ctaLabel={publishState.isPublishing
            ? t('builder_domain_publishing')
            : t('builder_domain_publish_now')
          }
          onCtaClick={handlePublish}
          ctaDisabled={isPublishDisabled}
        />
      </Box>
    );
  }

  return (
    <Box gap="lg" className="@container">
      {!isDomainAttachEnabled && !isProjectDomainEnabled && (
        <>
          <text.h1>{t('builder_domain_title')}</text.h1>
          <text.p>{t('builder_domain_coming_soon')}</text.p>
        </>
      )}
      {isProjectDomainEnabled && <ProjectDomain />}
      {isDomainAttachEnabled && <DomainAttach />}
    </Box>
  )
}
