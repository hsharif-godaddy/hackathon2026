'use client'

import { useRouter } from 'next/navigation';
import { generateClickEID } from '@/utils/instrumentation';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import { SettingsSection } from '@/app/develop/components/types';
import { useSettingsNavItems } from '@/app/develop/components/settings/useSettingsNavItems';
import Button from '@ux/button';

export default function SettingsPane() {
  const router = useRouter()
  const appId = useAppIdFromParams()

  const activeSettingsSection = useDevelopPageStore((state) => state.activeSettingsSection)
  const setActiveSettingsSection = useDevelopPageStore((state) => state.setActiveSettingsSection)

  const handleNavigate = (id: SettingsSection) => {
    setActiveSettingsSection(id)
    router.push(`/develop/${appId}?tab=settings&settings=${id}`, { scroll: false })
  }

  const items = useSettingsNavItems()

  return (
    <div className="flex grow flex-col overflow-y-auto">
      <div className="flex flex-col gap-1 h-full">
        {items.map((item) => (
          <Button
            design="option"
            size='sm'
            active={activeSettingsSection === item.id}
            key={item.id}
            data-eid={generateClickEID('develop.settings.item')}
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
