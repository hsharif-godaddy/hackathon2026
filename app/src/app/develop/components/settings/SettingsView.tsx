'use client'

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SettingsSection } from '@/app/develop/components/types'
import ProjectPanel from '@/app/develop/components/settings/ProjectPanel'
import DomainPanel from '@/app/develop/components/settings/DomainPanel'
import BackupsPanel from '@/app/develop/components/settings/BackupsPanel'
import SecurityPanel from '@/app/develop/components/settings/SecurityPanel'
import { DatabasePanel } from '@/app/develop/components/settings/DatabasePanel'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useSwitchboard } from '@/hooks/useSwitchboard';

export default function SettingsView() {
  const { activeSettingsSection } = useDevelopPageStore()
  const { featureFlags } = useSwitchboard();
  const appId = useAppIdFromParams()

  const renderSection = () => {
    switch (activeSettingsSection) {
      case SettingsSection.PROJECT:
        return featureFlags['appbuilder-settings-project'] ? <ProjectPanel /> : null;
      case SettingsSection.DOMAIN:
        return featureFlags['appbuilder-settings-domain'] ? <DomainPanel /> : null;
      case SettingsSection.BACKUPS:
        return featureFlags['appbuilder-settings-backups'] ? <BackupsPanel /> : null;
      case SettingsSection.SECURITY:
        return featureFlags['appbuilder-settings-security'] ? <SecurityPanel /> : null;
      case SettingsSection.DATABASE:
        return featureFlags['appbuilder-settings-database'] ? <DatabasePanel appId={appId} /> : null;
      case SettingsSection.FEEDBACK:
      default:
        return featureFlags['appbuilder-settings-project'] ? <ProjectPanel /> : null;
    }
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-6">
      {renderSection()}
    </div>
  )
}
