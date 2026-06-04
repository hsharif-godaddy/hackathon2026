'use client'

import { useMemo, useState } from 'react'
import Button from '@ux/button'
import DesktopIcon from '@ux/icon/desktop'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import TabletIcon from '@ux/icon/tablet'

import IconButton from '@/app/[market]/develop/components/IconButton'
import { PreviewViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useTranslations } from '@/hooks/useTranslations'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logClickEvent } from '@/utils/instrumentation'

interface DeviceSelectorProps {
  disabled?: boolean
}

const BREAKPOINT_MENU_ITEMS = [
  {
    category: PreviewViewMode.DESKTOP,
    labelKey: 'builder_analytics_desktop_laptop',
    instrumentationId: 'desktop',
  },
  {
    category: PreviewViewMode.TABLET,
    labelKey: 'builder_analytics_tablet',
    instrumentationId: 'tablet',
  },
  {
    category: PreviewViewMode.MOBILE,
    labelKey: 'builder_analytics_mobile',
    instrumentationId: 'mobile',
  },
] as const

function getCategoryIcon(category: PreviewViewMode) {
  if (category === PreviewViewMode.MOBILE) {
    return <MobilePhoneIcon className="size-2.5" />
  }
  if (category === PreviewViewMode.TABLET) {
    return <TabletIcon className="size-2.5" />
  }
  return <DesktopIcon className="size-2.5" />
}

export default function DeviceSelector({ disabled = false }: DeviceSelectorProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId])

  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)

  function breakpointRowClick(category: PreviewViewMode, instrumentationId: string) {
    return function selectBreakpointRow() {
      logClickEvent(`develop.preview.device_select_${instrumentationId}`, clickContext)()
      setPreviewViewMode(category)
      setOpen(false)
    }
  }

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon={getCategoryIcon(previewViewMode)}
          label={t('builder_preview_button_device')}
          showLabelWhenActive={false}
          disabled={disabled}
          data-testid="preview-device-selector-trigger"
          onClick={() => {
            logClickEvent('develop.preview.device_selector', clickContext)()
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-max max-w-[320px] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-0.5">
          {BREAKPOINT_MENU_ITEMS.map((item) => (
            <Button
              key={item.category}
              design="option"
              size="sm"
              active={previewViewMode === item.category}
              icon={getCategoryIcon(item.category)}
              text={t(item.labelKey)}
              className="!justify-start"
              onClick={breakpointRowClick(item.category, item.instrumentationId)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
