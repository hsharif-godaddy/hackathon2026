'use client'

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SettingsSection } from '@/app/develop/components/types'
import ProjectPanel from '@/app/develop/components/settings/ProjectPanel'
import DomainPanel from '@/app/develop/components/settings/DomainPanel'
import BackupsPanel from '@/app/develop/components/settings/BackupsPanel'
import SecurityPanel from '@/app/develop/components/settings/SecurityPanel'
import VisualScanPanel from '@/app/develop/components/settings/VisualScanPanel'
import LogsPanel from '@/app/develop/components/settings/LogsPanel'
import ConversationsPanel from '@/app/develop/components/settings/ConversationsPanel'
import { DatabasePanel } from '@/app/develop/components/settings/Database/DatabasePanel'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { SecretsPanel } from './SecretsPanel'
import SocialPanel from '@/app/develop/components/settings/SocialPanel'

export default function SettingsView() {
  const activeSettingsSection = useDevelopPageStore((state) => state.activeSettingsSection)
  const appId = useAppIdFromParams()

  const { data: isProjectEnabled } = useSwitchboard('appbuilder-settings-project');
  const { data: isDomainEnabled } = useSwitchboard('appbuilder-settings-domain');
  const { data: isBackupsEnabled } = useSwitchboard('appbuilder-settings-backups');
  const { data: isSecurityEnabled } = useSwitchboard('appbuilder-settings-security');
  const { data: isDatabaseEnabled } = useSwitchboard('appbuilder-settings-database');
  const { data: isVisualScanEnabled } = useSwitchboard('appbuilder-settings-visualscan');
  const { data: isSecretsEnabled } = useSwitchboard('appbuilder-settings-secrets');
  const { data: isSocialEnabled } = useSwitchboard('appbuilder-settings-social');
  const { data: isLogsEnabled } = useSwitchboard('appbuilder-settings-logs');
  const { data: isConversationsEnabled } = useSwitchboard('appbuilder-settings-conversations');

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
      case SettingsSection.DATABASE:
        return isDatabaseEnabled ? <DatabasePanel appId={appId} /> : null;
      case SettingsSection.SECRETS:
        return isSecretsEnabled ? <SecretsPanel appId={appId} variant="preview" /> : null;
      case SettingsSection.SOCIAL:
        return isSocialEnabled ? <SocialPanel /> : null;
      case SettingsSection.VISUAL_SCAN:
        return isVisualScanEnabled ? <VisualScanPanel /> : null;
      case SettingsSection.LOGS:
        return isLogsEnabled ? <LogsPanel /> : null;
      case SettingsSection.CONVERSATIONS:
        return isConversationsEnabled ? <ConversationsPanel /> : null;
      case SettingsSection.FEEDBACK:
      default:
        return isProjectEnabled ? <ProjectPanel /> : null;
    }
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-2 w-full md:max-w-5xl mx-auto">
      {renderSection()}
    </div>
  )
}
