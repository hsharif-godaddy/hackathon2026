'use client'

import dynamic from 'next/dynamic'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useSwitchboard } from '@/hooks/useSwitchboard'

// Only one panel renders at a time, so lazy-load each to keep the initial
// develop page bundle small (AnalyticsPanel alone pulls in recharts ~500KB gz).
const DatabasePanel = dynamic(() => import('@/app/[market]/develop/components/settings/Database/DatabasePanel').then(m => ({ default: m.DatabasePanel })), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DATABASE} /> })
const DomainPanel = dynamic(() => import('@/app/[market]/develop/components/settings/DomainPanel'), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DOMAIN} /> })
const ProjectPanel = dynamic(() => import('@/app/[market]/develop/components/settings/ProjectPanel'), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.PROJECT} /> })
const SecretsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/SecretsPanel').then(m => ({ default: m.SecretsPanel })), { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.SECRETS} /> })

// Uses SettingsLoadingState as its either RemoteModulePage or is complex to create a skeleton
const BackupsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/BackupsPanel'), { loading: () => <SettingsLoadingState fullPage /> })
const MarketingPanel = dynamic(() => import('@/app/[market]/develop/components/settings/MarketingPanel'), { loading: () => <SettingsLoadingState fullPage />  })

// Uses default skeleton as its matching the structure
const SecurityPanel = dynamic(() => import('@/app/[market]/develop/components/settings/SecurityPanel'), { loading: () => <PanelSkeleton /> })
const SharePanel = dynamic(() => import('@/app/[market]/develop/components/settings/SharePanel'), { loading: () => <PanelSkeleton /> })
const SocialPanel = dynamic(() => import('@/app/[market]/develop/components/settings/social/SocialPanel'), { loading: () => <PanelSkeleton /> })
const VisualScanPanel = dynamic(() => import('@/app/[market]/develop/components/settings/VisualScanPanel'), { loading: () => <PanelSkeleton /> })

export default function SettingsView() {
  const { activeChatTab, activeSettingsSection } = useChatTabs()
  const appId = useAppIdFromParams()

  // Defer switchboard calls until settings is actually visible — even after the
  // first lazy mount the component stays in the DOM (CSS-hidden), so without
  // this guard every flag fires on subsequent tab switches.
  const isSettingsActive = activeChatTab === ChatTab.SETTINGS

  const { data: isProjectEnabled } = useSwitchboard('appbuilder-settings-project', { enabled: isSettingsActive });
  const { data: isDomainEnabled } = useSwitchboard('appbuilder-settings-domain', { enabled: isSettingsActive });
  const { data: isBackupsEnabled } = useSwitchboard('appbuilder-settings-backups', { enabled: isSettingsActive });
  const { data: isSecurityEnabled } = useSwitchboard('appbuilder-settings-security', { enabled: isSettingsActive });
  const { data: isShareLinksEnabled } = useSwitchboard('appbuilder-share-links', { enabled: isSettingsActive });
  const { data: isVisualScanEnabled } = useSwitchboard('appbuilder-settings-visualscan', { enabled: isSettingsActive });
  const { data: isSecretsEnabled } = useSwitchboard('appbuilder-settings-secrets', { enabled: isSettingsActive });
  const { data: isSocialEnabled } = useSwitchboard('appbuilder-settings-social', { enabled: isSettingsActive });
  const { data: isMarketingEnabled } = useSwitchboard('appbuilder-settings-marketing', { enabled: isSettingsActive });

  const sectionSkeleton = <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={activeSettingsSection} />

  const renderSection = () => {
    switch (activeSettingsSection) {
      case SettingsSection.PROJECT:
        if (isProjectEnabled === undefined) return sectionSkeleton;
        return isProjectEnabled ? <ProjectPanel /> : null;
      case SettingsSection.DOMAIN:
        if (isDomainEnabled === undefined) return sectionSkeleton;
        return isDomainEnabled ? <DomainPanel /> : null;
      case SettingsSection.BACKUPS:
        if (isBackupsEnabled === undefined) return sectionSkeleton;
        return isBackupsEnabled ? <BackupsPanel /> : null;
      case SettingsSection.SECURITY:
        if (isSecurityEnabled === undefined) return sectionSkeleton;
        return isSecurityEnabled ? <SecurityPanel /> : null;
      case SettingsSection.SHARE:
        if (isShareLinksEnabled === undefined) return sectionSkeleton;
        return isShareLinksEnabled ? <SharePanel /> : null;
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
      case SettingsSection.FEEDBACK:
      default:
        if (isProjectEnabled === undefined) return sectionSkeleton;
        return isProjectEnabled ? <ProjectPanel /> : null;
    }
  }

  return (
    <div className={`h-full flex flex-col overflow-y-auto w-full px-1.5 pb-2 md:px-0.5 md:max-w-7xl mx-auto`}>
      {renderSection()}
    </div>
  )
}
