'use client'

import Button from '@ux/button';

import { useSettingsNavItems } from '@/app/develop/components/settings/useSettingsNavItems';
import { ChatTab, SettingsSection } from '@/app/develop/components/types';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { generateClickEID } from '@/utils/instrumentation';

export default function SettingsPane() {
  const { activeChatTab, activeSettingsSection, setActiveSettingsSection } = useChatTabs()

  const handleNavigate = (id: SettingsSection) => {
    setActiveSettingsSection(id)
  }

  const items = useSettingsNavItems(activeChatTab === ChatTab.SETTINGS)

  return (
    <div className="flex grow flex-col overflow-y-auto">
      <div className="flex flex-col gap-1 h-full">
        {items.map((item) => (
          <Button
            design="option"
            size="sm"
            active={activeSettingsSection === item.id}
            key={item.id}
            data-eid={generateClickEID('develop.settings.item')}
            icon={item.icon}
            text={item.label}
            disabled={item.disabled}
            className={`!justify-start ${activeSettingsSection === item.id ? '!bg-intents-ux-boxHighContrast-backgroundColor !text-intents-ux-boxHighContrast-foregroundColor [&_svg]:!text-intents-ux-boxHighContrast-foregroundColor' : ''}`}
            onClick={() => {
              if (item.needsAuth) {
                useAuthUIStore.getState().setNeedsReauth('session_expired');
              } else if (item.onClick) {
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
