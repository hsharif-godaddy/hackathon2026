import { useEffect, useRef, useState } from 'react';
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
import { COHORT_ON, EXPERIMENT_IDS } from '@/config/experiments';
import { useDomainPolling } from '@/hooks/useDomainPolling';
import { useEnterpriseManaged } from '@/hooks/useEnterpriseManaged';
import { useHivemind } from '@/hooks/useHivemind';
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
  // Treatment cohort connects pre-publish, so it skips the "publish first" empty state.
  const { cohort: defaultDomainSelectionCohort } = useHivemind(EXPERIMENT_IDS.defaultDomainSelection);
  const isPrePublishConnectEnabled: boolean = defaultDomainSelectionCohort === COHORT_ON;

  // "Use a domain I own elsewhere" deep-links here via #custom-domain-slug. Tracked as a nonce so
  // the connect UI shows pre-publish and acts as a treatment-only bypass regardless of cohort.
  const [externalConnectDeepLinkNonce, setExternalConnectDeepLinkNonce] = useState<number>(
    () => (typeof window !== 'undefined' && window.location.hash === '#custom-domain-slug' ? 1 : 0),
  );
  useEffect(function watchExternalConnectDeepLink() {
    if (typeof window === 'undefined') return;
    // Clear the hash captured at mount (initializer already counted it) so it doesn't linger.
    if (window.location.hash === '#custom-domain-slug') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    function onHashChange() {
      if (window.location.hash !== '#custom-domain-slug') return;
      setExternalConnectDeepLinkNonce((nonce) => nonce + 1);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    window.addEventListener('hashchange', onHashChange);
    return function cleanup() {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
  const isExternalConnectDeepLink: boolean = externalConnectDeepLinkNonce > 0;

  // "Edit" on the publish popover's temp-URL card deep-links here via #project-domain so the page
  // scrolls straight to the Project Domain section instead of landing at the top (AIROBUILD-3501).
  const [projectDomainDeepLinkNonce, setProjectDomainDeepLinkNonce] = useState<number>(
    () => (typeof window !== 'undefined' && window.location.hash === '#project-domain' ? 1 : 0),
  );
  useEffect(function watchProjectDomainDeepLink() {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#project-domain') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    function onHashChange() {
      if (window.location.hash !== '#project-domain') return;
      setProjectDomainDeepLinkNonce((nonce) => nonce + 1);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    window.addEventListener('hashchange', onHashChange);
    return function cleanup() {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
  // Scroll once the section is actually rendered — gate on load state so a deep link that arrives
  // while the panel is still a skeleton re-fires this effect after the section mounts.
  useEffect(function scrollToProjectDomainOnDeepLink() {
    if (!projectDomainDeepLinkNonce || isSiteLoading || isPaywallLoading) return;
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(function scrollProjectDomainIntoView() {
      const section = document.getElementById('project-domain-section');
      if (!section || typeof section.scrollIntoView !== 'function') return;
      section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [projectDomainDeepLinkNonce, isSiteLoading, isPaywallLoading]);

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

  // First-time publish prompt (nothing published, no custom domains). Treatment cohort or the
  // deep link skips it and connects pre-publish from the management UI below.
  if (!isSiteLoading && !canManageDomains && !isPrePublishConnectEnabled && !isExternalConnectDeepLink && (isDomainAttachEnabled || isProjectDomainEnabled)) {
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
            <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} externalConnectDeepLinkNonce={externalConnectDeepLinkNonce} />
          </Box>
        )}

        <Box id="project-domain-section" className={isDomainAttachEnabled ? 'mt-5 w-full min-w-0' : 'w-full min-w-0'}>
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
          {isDomainAttachEnabled && <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} externalConnectDeepLinkNonce={externalConnectDeepLinkNonce} />}
        </>
      ) : hasActiveCustomDomain ? (
        <>
          {isDomainAttachEnabled && <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} externalConnectDeepLinkNonce={externalConnectDeepLinkNonce} />}
        </>
      ) : (
        <>
          {isDomainAttachEnabled && <DomainAttach appDetails={appDetails} isAppDetailsFetched={isAppDetailsFetched} externalConnectDeepLinkNonce={externalConnectDeepLinkNonce} />}
        </>
      )}
    </Box>
  )
}
