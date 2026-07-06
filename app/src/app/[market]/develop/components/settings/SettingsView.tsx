'use client'

import dynamic from 'next/dynamic'
import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import ArrowLeftIcon from '@ux/icon/arrow-left'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import GitHubSyncSettingsSavedSnackbar from '@/app/[market]/develop/components/settings/GitHubPanel/GitHubSyncSettingsSavedSnackbar'
import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useSeoSettingsEnabled } from '@/hooks/useSeoSettingsEnabled'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'

// Only one panel renders at a time, so lazy-load each to keep the initial
// develop page bundle small (AnalyticsPanel alone pulls in recharts ~500KB gz).
const DatabasePanel = dynamic(() => import('@/app/[market]/develop/components/settings/Database/DatabasePanel').then(m => ({ default: m.DatabasePanel })), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DATABASE} /> })
const DomainPanel = dynamic(() => import('@/app/[market]/develop/components/settings/DomainPanel'), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DOMAIN} /> })
const ProjectPanel = dynamic(() => import('@/app/[market]/develop/components/settings/ProjectPanel'), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.PROJECT} /> })
const SecretsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/SecretsPanel').then(m => ({ default: m.SecretsPanel })), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.SECRETS} /> })
const DisplayAdsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel').then(m => ({ default: m.DisplayAdsPanel })), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DISPLAY_ADS} /> })

// Uses SettingsLoadingState as its either RemoteModulePage or is complex to create a skeleton
const BackupsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/BackupsPanel'), { loading: () => <SettingsLoadingState fullPage /> })
const MarketingPanel = dynamic(() => import('@/app/[market]/develop/components/settings/MarketingPanel'), { loading: () => <SettingsLoadingState fullPage />  })
const CampaignsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/CampaignsPanel'), { loading: () => <SettingsLoadingState fullPage />  })

// Uses default skeleton as its matching the structure
const SecurityPanel = dynamic(() => import('@/app/[market]/develop/components/settings/SecurityPanel'), { loading: () => <PanelSkeleton /> })
const SocialPanel = dynamic(() => import('@/app/[market]/develop/components/settings/social/SocialPanel'), { loading: () => <PanelSkeleton /> })
const SeoPanel = dynamic(() => import('@/app/[market]/develop/components/settings/SeoPanel'), { loading: () => <PanelSkeleton /> })
const GitHubPanel = dynamic(() => import('@/app/[market]/develop/components/settings/GitHubPanel'), { loading: () => <PanelSkeleton /> })
const SsoPanel = dynamic(() => import('@/app/[market]/develop/components/settings/SsoPanel'), { loading: () => <PanelSkeleton /> })
const VisualScanPanel = dynamic(() => import('@/app/[market]/develop/components/settings/VisualScanPanel'), { loading: () => <PanelSkeleton /> })
const AnalyticsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/Analytics/AnalyticsPanel'), { loading: () => <SettingsLoadingState fullPage /> })
const TeamPanel = dynamic(() => import('@/app/[market]/develop/components/settings/TeamPanel'), { loading: () => <SettingsLoadingState fullPage /> })

function TeamPanelWithBackButton({ onBack }: { onBack: () => void }): React.ReactElement {
  const t = useTranslations()

  useEffect(() => {
    document.body.classList.add('share-access-open')
    return () => document.body.classList.remove('share-access-open')
  }, [])

  const canPortal: boolean = typeof document !== 'undefined'

  return (
    <>
      {canPortal && createPortal(
        <button
          type="button"
          onClick={onBack}
          aria-label={t('builder_common_back', undefined, 'Back')}
          data-testid="team-panel-back"
          className="fixed top-3 left-3 z-[1001] flex items-center gap-1 rounded-full border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-3 py-2 shadow-md"
        >
          <ArrowLeftIcon className="size-2.5" />
        </button>,
        document.body
      )}
      <TeamPanel />
    </>
  )
}

export default function SettingsView() {
  const { activeSettingsSection, setActiveSettingsSection } = useChatTabs()
  const appId = useAppIdFromParams()

  const isProjectEnabled = useSwitchboard('appbuilder-settings-project');
  const isDomainEnabled = useSwitchboard('appbuilder-settings-domain');
  const isBackupsEnabled = useSwitchboard('appbuilder-settings-backups');
  const isSecurityEnabled = useSwitchboard('appbuilder-settings-security');
  const isVisualScanEnabled = useSwitchboard('appbuilder-settings-visualscan');
  const isSecretsEnabled = useSwitchboard('appbuilder-settings-secrets');
  const isSocialEnabled = useSwitchboard('appbuilder-settings-social');
  const isMarketingEnabled = useSwitchboard('appbuilder-settings-marketing');
  const isDisplayAdsEnabled = useSwitchboard('appbuilder-settings-display-ads');
  const isGitHubEnabled = useSwitchboard('appbuilder-github-sync');
  const isCampaignsEnabled = useSwitchboard('appbuilder-marketing-campaigns');
  const isSeoEnabled = useSeoSettingsEnabled();
  const isAnalyticsEnabled = useSwitchboard('appbuilder-analytics');
  const isMultiUserEnabled = useSwitchboard('aab-multi-user');

  const sectionSkeleton = <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={activeSettingsSection} />

  const renderSection = () => {
    switch (activeSettingsSection) {
      case SettingsSection.DOMAIN:
        if (isDomainEnabled === undefined) return sectionSkeleton;
        return isDomainEnabled ? <DomainPanel /> : null;
      case SettingsSection.PROJECT:
        if (isProjectEnabled === undefined) return sectionSkeleton;
        return isProjectEnabled ? <ProjectPanel /> : null;
      case SettingsSection.BACKUPS:
        if (isBackupsEnabled === undefined) return sectionSkeleton;
        return isBackupsEnabled ? <BackupsPanel /> : null;
      case SettingsSection.SECURITY:
        if (isSecurityEnabled === undefined) return sectionSkeleton;
        return isSecurityEnabled ? <SecurityPanel /> : null;
      case SettingsSection.DATABASE:
        // No switchboard guard — DATABASE is always enabled (no feature flag)
        return <DatabasePanel appId={appId} />;
      case SettingsSection.SECRETS:
        if (isSecretsEnabled === undefined) return sectionSkeleton;
        return isSecretsEnabled ? <SecretsPanel appId={appId} variant="preview" /> : null;
      case SettingsSection.SOCIAL:
        if (isSocialEnabled === undefined) return sectionSkeleton;
        return isSocialEnabled ? <SocialPanel siteId={appId} /> : null;
      case SettingsSection.VISUAL_SCAN:
        if (isVisualScanEnabled === undefined) return sectionSkeleton;
        return isVisualScanEnabled ? <VisualScanPanel /> : null;
      case SettingsSection.MARKETING:
        if (isMarketingEnabled === undefined) return sectionSkeleton;
        return isMarketingEnabled ? <MarketingPanel /> : null;
      case SettingsSection.DISPLAY_ADS:
        if (isDisplayAdsEnabled === undefined) return sectionSkeleton;
        return isDisplayAdsEnabled ? <DisplayAdsPanel appId={appId} /> : null;
      case SettingsSection.GITHUB:
        if (isGitHubEnabled === undefined) return sectionSkeleton;
        return isGitHubEnabled ? <GitHubPanel /> : null;
      case SettingsSection.SSO:
        // No switchboard guard — visibility is purely admin-controlled per app
        // via mhp-core's `apps.sso_required` (Phase 1). The SsoPanel itself
        // returns null when ssoRequired is false, so wiring it here is safe
        // for non-ent apps too.
        return <SsoPanel />;
      case SettingsSection.CAMPAIGNS:
        if (isCampaignsEnabled === undefined) return sectionSkeleton;
        return isCampaignsEnabled ? <CampaignsPanel /> : null;
      case SettingsSection.SEO:
        if (isSeoEnabled === undefined) return sectionSkeleton;
        return isSeoEnabled ? <SeoPanel siteId={appId} /> : null;
      case SettingsSection.ANALYTICS:
        if (isAnalyticsEnabled === undefined) return sectionSkeleton;
        return isAnalyticsEnabled ? <AnalyticsPanel /> : null;
      case SettingsSection.TEAM:
        if (isMultiUserEnabled === undefined) return sectionSkeleton;
        return isMultiUserEnabled ? <TeamPanelWithBackButton onBack={() => setActiveSettingsSection(SettingsSection.PROJECT)} /> : null;
      case SettingsSection.FEEDBACK:
      default:
        if (isProjectEnabled === undefined) return sectionSkeleton;
        return isProjectEnabled ? <ProjectPanel /> : null;
    }
  }

  return (
    <div className={`h-full flex flex-col overflow-y-auto w-full px-1.5 pb-2 md:px-0.5 md:max-w-7xl mx-auto`}>
      <GitHubSyncSettingsSavedSnackbar placement="settings-view" />
      {renderSection()}
    </div>
  )
}
