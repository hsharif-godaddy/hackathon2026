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
import { EnterpriseUpgradeNotice } from '@/components/upgrade/EnterpriseUpgradeNotice';
import { useDomainPolling } from '@/hooks/useDomainPolling';
import { useEnterpriseManaged } from '@/hooks/useEnterpriseManaged';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { useSwitchboard } from "@/hooks/useSwitchboard";
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus, DomainType } from "@/lib/control-plane/types";
import { shipAnalyticsLog } from '@/lib/logging';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { useDevelopPageStore } from "@/stores/useDevelopPageStore";
import { usePaywallStore } from "@/stores/usePaywallStore";
import { useSiteStore } from "@/stores/useSiteStore";
import RidingArrow from '@/svgs/riding-arrow';
import { generateClickEID } from '@/utils/instrumentation';
import { canAccessDomainManagement } from '@/utils/site';
import { usePublishForDomain } from './usePublishForDomain';

export default function DomainPanel() {
  const t = useTranslations();
  const isDomainAttachEnabled = useSwitchboard('appbuilder-domain-attach');
  const isDomainConnectEnabled = useSwitchboard('appbuilder-domain-connect');
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

  // Pass appId so an invited collaborator (owner-pays) bypasses the paywall.
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(currentAppId);
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal);
  const { isEnterpriseManaged } = useEnterpriseManaged();

  const { handlePublish, isPublishDisabled, publishState } = usePublishForDomain(currentAppId, site);
  const canManageDomains = canAccessDomainManagement(site);

  const hasActiveDomainJob = useDevelopPageStore(
    (s) => Boolean(currentAppId && s.domainJobsInProgress?.[currentAppId]),
  );

  // Use polling query as single source of truth for domain ordering
  const { data: appDetails, isFetched: isAppDetailsFetched } = useDomainPolling(currentAppId, { hasActiveJob: hasActiveDomainJob });
  const hasActiveCustomDomain = appDetails?.domains?.some(
    (d) =>
      d.domainType !== DomainType.PREFIX &&
      (d.status === DomainStatus.ACTIVE || d.status === DomainStatus.PENDING),
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
            {isEnterpriseManaged ? (
              <EnterpriseUpgradeNotice testId="domain-panel-enterprise-upgrade-notice" />
            ) : (
              <Button
                text={t('builder_upgrade_button')}
                design="primary"
                size="sm"
                onClick={() => openUpgradeModal('domains.upgrade', PAYWALL_ITC.UPGRADE)}
                data-eid={generateClickEID(`settings.domains.upgrade`)}
              />
            )}
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

  if (isProjectDomainEnabled) {
    return (
      <Box className="@container">
        <Box orientation="vertical" className="mb-[40px] flex w-full flex-col gap-[8px]">
          <h1
            className="m-0 text-intents-ux-text-primaryColor"
            style={{ fontSize: 28, fontWeight: 700, lineHeight: '28px' }}
          >
            {t('builder_domain_title', undefined, 'Domains')}
          </h1>
          <text.p className="!m-0 !text-[14px] leading-tight text-intents-ux-text-secondaryColor">
            {t(
              'builder_domain_page_description',
              undefined,
              'Buy, connect and manage domains associated with your project',
            )}
          </text.p>
        </Box>

        {isDomainAttachEnabled && (
          <Box className="w-full min-w-0">
            <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} />
          </Box>
        )}

        <Box className={isDomainAttachEnabled ? 'mt-5 w-full min-w-0' : 'w-full min-w-0'}>
          <ProjectDomain />
        </Box>
      </Box>
    );
  }

  return (
    <Box gap={isDomainConnectEnabled ? "lg" : "sm"} className="@container">
      {!isDomainAttachEnabled && !isProjectDomainEnabled && (
        <>
          <text.h1>{t('builder_domain_title')}</text.h1>
          <text.p>{t('builder_domain_coming_soon')}</text.p>
      </>
      )}
      {isDomainConnectEnabled ? (
        <>
          {isDomainAttachEnabled && <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} />}
        </>
      ) : hasActiveCustomDomain ? (
        <>
          {isDomainAttachEnabled && <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} />}
        </>
      ) : (
        <>
          {isDomainAttachEnabled && <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} />}
        </>
      )}
    </Box>
  )
}
