import { useEffect, useRef } from 'react';
import Box from "@ux/box";
import Button from "@ux/button";
import WebsiteIcon from '@ux/icon/website';
import text from "@ux/text";

import PanelSkeleton from "@/app/[market]/develop/components/PanelSkeleton";
import DomainAttach from "@/app/[market]/develop/components/settings/DomainPanel/DomainAttach";
import ProjectDomain from "@/app/[market]/develop/components/settings/DomainPanel/ProjectDomain";
import { ChatTab, SettingsSection } from "@/app/[market]/develop/components/types";
import { useAppIdFromParams } from "@/app/[market]/develop/components/utils";
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useDomainPolling } from '@/hooks/useDomainPolling';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { useSwitchboard } from "@/hooks/useSwitchboard";
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus, DomainType } from "@/lib/control-plane/types";
import { shipAnalyticsLog } from '@/lib/logging';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { useDevelopPageStore } from "@/stores/useDevelopPageStore";
import { useSiteStore } from "@/stores/useSiteStore";
import RidingArrow from '@/svgs/riding-arrow';
import { generateClickEID } from '@/utils/instrumentation';
import { canAccessDomainManagement } from '@/utils/site';
import { usePublishForDomain } from './usePublishForDomain';

export default function DomainPanel() {
  const t = useTranslations();
  const isDomainAttachEnabled = useSwitchboard('appbuilder-domain-attach');
  const isProjectDomainEnabled = useSwitchboard('appbuilder-project-domain');
  const domainFeaturesEnabled = isDomainAttachEnabled || isProjectDomainEnabled;

  const currentAppId = useAppIdFromParams();
  const panelViewedAppIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentAppId || !domainFeaturesEnabled) return;
    if (panelViewedAppIdsRef.current.has(currentAppId)) return;
    panelViewedAppIdsRef.current.add(currentAppId);
    shipAnalyticsLog('settings.domains.panel_viewed', { appId: currentAppId });
  }, [currentAppId, domainFeaturesEnabled]);

  const site = useSiteStore((state) => {
    if (!currentAppId) return null;
    return state.getSite(currentAppId);
  });

  const isSiteLoading = useSiteStore((state) => {
    if (!currentAppId) return false;
    return state.loading[currentAppId] ?? false;
  });

  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility();
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal);

  const { handlePublish, isPublishDisabled, publishState } = usePublishForDomain(currentAppId, site);
  const canManageDomains = canAccessDomainManagement(site);

  const hasActiveDomainJob = useDevelopPageStore(
    (s) => Boolean(currentAppId && s.domainJobsInProgress?.[currentAppId]),
  );

  // Use polling query as single source of truth for domain ordering
  const { data: appDetails, isFetched: isAppDetailsFetched } = useDomainPolling(currentAppId, { hasActiveJob: hasActiveDomainJob });

  // Check if there's an active or pending custom domain to determine section order
  const hasActiveCustomDomain = appDetails?.domains?.some(
    d => d.domainType !== DomainType.PREFIX &&
      (d.status === DomainStatus.ACTIVE || d.status === DomainStatus.PENDING)
  ) ?? false;

  if (isSiteLoading || isPaywallLoading) {
    return <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DOMAIN} />;
  }

  // Show upgrade screen for free users who haven't published (no domains to clean up)
  if (!isSiteLoading && !canManageDomains && !isPaywallLoading && showPaywall && (isDomainAttachEnabled || isProjectDomainEnabled)) {
    return (
      <Box
        className="bg-intents-ux-box-backgroundColor rounded-lg p-6"
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
        <div className="flex-shrink-0 hidden md:block">
          <RidingArrow />
        </div>
      </Box>
    );
  }

  // First-time publish prompt when nothing is published and no custom domains remain
  if (!isSiteLoading && !canManageDomains && (isDomainAttachEnabled || isProjectDomainEnabled)) {
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
    <Box gap="sm" className="@container">
      {!isDomainAttachEnabled && !isProjectDomainEnabled && (
        <>
          <text.h1>{t('builder_domain_title')}</text.h1>
          <text.p>{t('builder_domain_coming_soon')}</text.p>
      </>
      )}
      {/* Conditionally render sections based on custom domain connection status */}
      {hasActiveCustomDomain ? (
        <>
          {isDomainAttachEnabled && <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} />}
          {isProjectDomainEnabled && <ProjectDomain />}
        </>
      ) : (
        <>
          {isProjectDomainEnabled && <ProjectDomain />}
          {isDomainAttachEnabled && <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} />}
        </>
      )}
    </Box>
  )
}
