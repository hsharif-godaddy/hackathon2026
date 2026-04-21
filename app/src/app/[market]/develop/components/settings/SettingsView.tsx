'use client'

import BackupsPanel from '@/app/[market]/develop/components/settings/BackupsPanel'
import { DatabasePanel } from '@/app/[market]/develop/components/settings/Database/DatabasePanel'
import DomainPanel from '@/app/[market]/develop/components/settings/DomainPanel'
import MarketingPanel from '@/app/[market]/develop/components/settings/MarketingPanel'
import ProjectPanel from '@/app/[market]/develop/components/settings/ProjectPanel'
import { SecretsPanel } from '@/app/[market]/develop/components/settings/SecretsPanel'
import SecurityPanel from '@/app/[market]/develop/components/settings/SecurityPanel'
import SharePanel from '@/app/[market]/develop/components/settings/SharePanel'
import SocialPanel from '@/app/[market]/develop/components/settings/social/SocialPanel'
import VisualScanPanel from '@/app/[market]/develop/components/settings/VisualScanPanel'
import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
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
  const { data: isVisualScanEnabled } = useSwitchboard('appbuilder-settings-visualscan', { enabled: isSettingsActive });
  const { data: isSecretsEnabled } = useSwitchboard('appbuilder-settings-secrets', { enabled: isSettingsActive });
  const { data: isSocialEnabled } = useSwitchboard('appbuilder-settings-social', { enabled: isSettingsActive });
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
      case SettingsSection.DATABASE:
        return <DatabasePanel appId={appId} />;
      case SettingsSection.SECRETS:
        return isSecretsEnabled ? <SecretsPanel appId={appId} variant="preview" /> : null;
      case SettingsSection.SOCIAL:
        return isSocialEnabled ? <SocialPanel siteId={appId} /> : null;
      case SettingsSection.VISUAL_SCAN:
        return isVisualScanEnabled ? <VisualScanPanel /> : null;
      case SettingsSection.MARKETING:
        return isMarketingEnabled ? <MarketingPanel /> : null;
      case SettingsSection.FEEDBACK:
      default:
        return isProjectEnabled ? <ProjectPanel /> : null;
    }
  }

  return (
    <div className={`h-full flex flex-col overflow-y-auto w-full px-1.5 pb-2 md:px-0.5 md:max-w-7xl mx-auto`}>
      {renderSection()}
    </div>
  )
}
