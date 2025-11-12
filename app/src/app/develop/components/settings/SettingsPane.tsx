'use client'

import { useRouter } from 'next/navigation';
import { generateClickEID } from '@/utils/instrumentation';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import { SettingsSection } from '@/app/develop/components/types';
import Button from '@ux/button';
import SettingsIcon from '@ux/icon/settings';
import LockedIcon from '@ux/icon/locked';
import DatabaseIcon from '@ux/icon/database';
import ClipboardIcon from '@ux/icon/clipboard';
import LinkIcon from '@ux/icon/link';
import RevertIcon from '@ux/icon/revert';
import { useSwitchboard } from '@/hooks/useSwitchboard';

export default function SettingsPane() {
  const router = useRouter()
  const appId = useAppIdFromParams()

  const { openFeedbackModal, activeSettingsSection, setActiveSettingsSection } = useDevelopPageStore()

  const { data: isProjectEnabled } = useSwitchboard('appbuilder-settings-project');
  const { data: isDomainEnabled } = useSwitchboard('appbuilder-settings-domain');
  const { data: isBackupsEnabled } = useSwitchboard('appbuilder-settings-backups');
  const { data: isSecurityEnabled } = useSwitchboard('appbuilder-settings-security');
  const { data: isDatabaseEnabled } = useSwitchboard('appbuilder-settings-database');
  const { data: isFeedbackEnabled } = useSwitchboard('appbuilder-settings-feedback');

  const handleNavigate = (id: SettingsSection) => {
    setActiveSettingsSection(id)
    router.push(`/develop/${appId}?tab=settings&settings=${id}`, { scroll: false })
  }

  const items = [
    {
      id: SettingsSection.PROJECT,
      label: 'Project Settings',
      icon: <SettingsIcon />,
      disabled: isProjectEnabled !== true,
    },
    {
      id: SettingsSection.DOMAIN,
      label: 'Domain',
      icon: <LinkIcon />,
      disabled: isDomainEnabled !== true,
    },
    {
      id: SettingsSection.BACKUPS,
      label: 'Backups',
      icon: <RevertIcon />,
      disabled: isBackupsEnabled !== true,
    },
    {
      id: SettingsSection.SECURITY,
      label: 'Security',
      icon: <LockedIcon />,
      disabled: isSecurityEnabled !== true,
    },
    {
      id: SettingsSection.DATABASE,
      label: 'Database',
      icon: <DatabaseIcon />,
      disabled: isDatabaseEnabled !== true,
    },
    {
      id: SettingsSection.FEEDBACK,
      label: 'Give Feedback',
      icon: <ClipboardIcon />,
      disabled: isFeedbackEnabled !== true,
      onClick: () => {
        if (isFeedbackEnabled) {
          localStorage.removeItem('airo-feedback-shown:airo#app-builder')
          openFeedbackModal('airo#app-builder')
        }
      },
    },
  ]
  return (
    <div className="flex grow flex-col overflow-y-auto">
      <div className="flex flex-col gap-2 h-full">
        {items.map((item) => (
          <Button
            design="option"
            active={activeSettingsSection === item.id}
            key={item.id}
            data-ed={generateClickEID('develop.settings.item')}
            icon={item.icon}
            text={item.label}
            disabled={item.disabled}
            className="!justify-start"
            onClick={() => {
              if (item.onClick) {
                item.onClick()
              } else {
                handleNavigate(item.id)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}
