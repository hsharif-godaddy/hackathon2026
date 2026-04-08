'use client'

import AnalyticsPanel from '@/app/develop/components/settings/Analytics/AnalyticsPanel'
import BackupsPanel from '@/app/develop/components/settings/BackupsPanel'
import { DatabasePanel } from '@/app/develop/components/settings/Database/DatabasePanel'
import DomainPanel from '@/app/develop/components/settings/DomainPanel'
import MarketingPanel from '@/app/develop/components/settings/MarketingPanel'
import ProjectPanel from '@/app/develop/components/settings/ProjectPanel'
import { SecretsPanel } from '@/app/develop/components/settings/SecretsPanel'
import SecurityPanel from '@/app/develop/components/settings/SecurityPanel'
import SharePanel from '@/app/develop/components/settings/SharePanel'
import SocialPanel from '@/app/develop/components/settings/social/SocialPanel'
import TeamPanel from '@/app/develop/components/settings/TeamPanel'
import VisualScanPanel from '@/app/develop/components/settings/VisualScanPanel'
import { ChatTab, SettingsSection } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useSwitchboard } from '@/hooks/useSwitchboard'

export default function SettingsView() {
  const { activeChatTab, activeSettingsSection } = useChatTabs()
  const appId = useAppIdFromParams()

  // Only fetch flags when the settings tab is actually open.
  // SettingsView is always mounted (opacity-based tab switching), so without this
  // guard all 11 calls fire on every page load even when settings is never visited.
  const isSettingsActive = activeChatTab === ChatTab.SETTINGS

  const { data: isProjectEnabled } = useSwitchboard('appbuilder-settings-project', { enabled: isSettingsActive });
  const { data: isDomainEnabled } = useSwitchboard('appbuilder-settings-domain', { enabled: isSettingsActive });
  const { data: isBackupsEnabled } = useSwitchboard('appbuilder-settings-backups', { enabled: isSettingsActive });
  const { data: isSecurityEnabled } = useSwitchboard('appbuilder-settings-security', { enabled: isSettingsActive });
  const { data: isShareLinksEnabled } = useSwitchboard('appbuilder-share-links', { enabled: isSettingsActive });
  const { data: isTeamEnabled } = useSwitchboard('appbuilder-settings-team', { enabled: isSettingsActive });
  const { data: isVisualScanEnabled } = useSwitchboard('appbuilder-settings-visualscan', { enabled: isSettingsActive });
  const { data: isSecretsEnabled } = useSwitchboard('appbuilder-settings-secrets', { enabled: isSettingsActive });
  const { data: isSocialEnabled } = useSwitchboard('appbuilder-settings-social', { enabled: isSettingsActive });
  const { data: isAnalyticsEnabled } = useSwitchboard('appbuilder-settings-analytics', { enabled: isSettingsActive });
  const { data: isMarketingEnabled } = useSwitchboard('appbuilder-settings-marketing', { enabled: isSettingsActive });

  const renderSection = () => {
    switch (activeSettingsSection) {
      case SettingsSection.PROJECT:
        return isProjectEnabled ? <ProjectPanel /> : null;
      case SettingsSection.DOMAIN:
        return isDomainEnabled ? <DomainPanel /> : null;
      case SettingsSection.BACKUPS:
        return isBackupsEnabled ? <BackupsPanel /> : null;
      case SettingsSection.SECURITY:
        return isSecurityEnabled ? <SecurityPanel /> : null;
      case SettingsSection.SHARE:
        return isShareLinksEnabled ? <SharePanel /> : null;
      case SettingsSection.TEAM:
        return isTeamEnabled ? <TeamPanel /> : null;
      case SettingsSection.DATABASE:
        return <DatabasePanel appId={appId} />;
      case SettingsSection.SECRETS:
        return isSecretsEnabled ? <SecretsPanel appId={appId} variant="preview" /> : null;
      case SettingsSection.SOCIAL:
        return isSocialEnabled ? <SocialPanel siteId={appId} /> : null;
      case SettingsSection.VISUAL_SCAN:
        return isVisualScanEnabled ? <VisualScanPanel /> : null;
      case SettingsSection.ANALYTICS:
        return isAnalyticsEnabled ? <AnalyticsPanel /> : null;
      case SettingsSection.MARKETING:
        return isMarketingEnabled ? <MarketingPanel /> : null;
      case SettingsSection.FEEDBACK:
      default:
        return isProjectEnabled ? <ProjectPanel /> : null;
    }
  }

  return (
    <div className={`h-full flex flex-col overflow-y-auto px-1.5 md:pr-2.5 md:pl-1 md:py-0 w-full md:max-w-7xl mx-auto`}>
      {renderSection()}
    </div>
  )
}
