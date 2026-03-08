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
import { SettingsSection } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useSwitchboard } from '@/hooks/useSwitchboard'

export default function SettingsView() {
  const { activeSettingsSection } = useChatTabs()
  const appId = useAppIdFromParams()

  const { data: isProjectEnabled } = useSwitchboard('appbuilder-settings-project');
  const { data: isDomainEnabled } = useSwitchboard('appbuilder-settings-domain');
  const { data: isBackupsEnabled } = useSwitchboard('appbuilder-settings-backups');
  const { data: isSecurityEnabled } = useSwitchboard('appbuilder-settings-security');
  const { data: isShareLinksEnabled } = useSwitchboard('appbuilder-share-links');
  const { data: isTeamEnabled } = useSwitchboard('appbuilder-settings-team');
  const { data: isVisualScanEnabled } = useSwitchboard('appbuilder-settings-visualscan');
  const { data: isSecretsEnabled } = useSwitchboard('appbuilder-settings-secrets');
  const { data: isSocialEnabled } = useSwitchboard('appbuilder-settings-social');
  const { data: isAnalyticsEnabled } = useSwitchboard('appbuilder-settings-analytics');
  const { data: isMarketingEnabled } = useSwitchboard('appbuilder-settings-marketing');

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

  // Use wider max-width for Marketing section to give calendar more room
  const maxWidthClass = activeSettingsSection === SettingsSection.MARKETING
    ? 'md:max-w-7xl'
    : 'md:max-w-5xl';

  return (
    <div className={`h-full flex flex-col overflow-y-auto p-2 w-full ${maxWidthClass} mx-auto`}>
      {renderSection()}
    </div>
  )
}
