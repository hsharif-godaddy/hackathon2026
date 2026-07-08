'use client'

import { useMemo, useState } from 'react'
import Button from '@ux/button'
import GraphIcon from '@ux/icon/graph'

import { CanvasMenuTrigger } from '@/app/[market]/commander/canvas/CanvasMenuTrigger'
import { SettingsNavItem, useSettingsNavItems } from '@/app/[market]/develop/components/settings/useSettingsNavItems'
import { SettingsSection } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logClickEvent } from '@/utils/instrumentation'

export function CommanderCanvasMenu() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId])

  const [open, setOpen] = useState(false)
  const baseItems = useSettingsNavItems()
  const isAnalyticsEnabled = useSwitchboard('appbuilder-analytics') === true

  const setActiveSettingsSection = useDevelopPageStore((state) => state.setActiveSettingsSection)
  const openCanvasSettings = useCommanderStore((state) => state.openCanvasSettings)

  const items = useMemo(() => {
    const withoutFeedback = baseItems.filter((item) => item.id !== SettingsSection.FEEDBACK)
    if (!isAnalyticsEnabled) return withoutFeedback
    const projectIndex = withoutFeedback.findIndex((item) => item.id === SettingsSection.PROJECT)
    const insertAt = projectIndex >= 0 ? projectIndex + 1 : withoutFeedback.length
    const analyticsItem = {
      id: SettingsSection.ANALYTICS,
      label: t('builder_settings_nav_analytics'),
      icon: <GraphIcon />,
      disabled: false,
    }
    return [
      ...withoutFeedback.slice(0, insertAt),
      analyticsItem,
      ...withoutFeedback.slice(insertAt),
    ]
  }, [baseItems, isAnalyticsEnabled, t])

  const handleSelect = (item: SettingsNavItem): void => {
    logClickEvent(`commander.canvas_menu.${item.id}`, clickContext)()
    if (item.onClick) {
      item.onClick()
    } else {
      setActiveSettingsSection(item.id)
      openCanvasSettings()
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CanvasMenuTrigger
          open={open}
          data-testid="commander-canvas-menu-trigger"
          label={t('builder_commander_open_canvas')}
          onOpenClick={() => logClickEvent('commander.canvas_menu.open', clickContext)()}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[220px] p-1">
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <Button
              key={item.id}
              design="option"
              size="sm"
              icon={item.icon}
              text={item.label}
              disabled={item.disabled}
              className="!justify-start"
              data-testid={`commander-canvas-menu-${item.id}`}
              onClick={() => handleSelect(item)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
