'use client'

import clsx from 'clsx'
import { useState } from 'react'
import CheckmarkIcon from '@ux/icon/checkmark'
import DesktopIcon from '@ux/icon/desktop'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import TabletIcon from '@ux/icon/tablet'

import { type DevicePreset, getDevicesByCategory } from '@/app/develop/components/preview/devicePresets'
import { PreviewViewMode } from '@/app/develop/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { generateClickEID } from '@/utils/instrumentation'

interface DeviceSelectorProps {
  disabled?: boolean
  separator?: boolean
}

export default function DeviceSelector({ disabled = false, separator = false }: DeviceSelectorProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations()

  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const selectedDeviceId = useDevelopPageStore((state) => state.selectedDeviceId)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)
  const setSelectedDeviceId = useDevelopPageStore((state) => state.setSelectedDeviceId)

  // Translate "Full size" for the 'full' device, use device.name for others
  function getDeviceDisplayName(device: DevicePreset): string {
    return device.id === 'full' ? t('builder_device_full_size', undefined, 'Full size') : device.name
  }

  function handleDeviceSelect(device: DevicePreset) {
    // Set preview mode first if it's changing
    // This allows the subsequent setSelectedDeviceId to override the default device
    if (previewViewMode !== device.category) {
      setPreviewViewMode(device.category)
    }

    // Set the specific device ID (will override any default set by setPreviewViewMode)
    setSelectedDeviceId(device.id)

    setOpen(false)
  }

  function getIcon() {
    if (previewViewMode === PreviewViewMode.MOBILE) {
      return <MobilePhoneIcon />
    }
    if (previewViewMode === PreviewViewMode.TABLET) {
      return <TabletIcon />
    }
    return <DesktopIcon />
  }

  // Group devices by category for display
  const desktopDevices = getDevicesByCategory(PreviewViewMode.DESKTOP)
  const phoneDevices = getDevicesByCategory(PreviewViewMode.MOBILE)
  const tabletDevices = getDevicesByCategory(PreviewViewMode.TABLET)

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger
        className={clsx(
          'flex items-center gap-0.5 px-1 py-0.5 text-sm font-normal rounded-xl border leading-none relative',
          'hover:cursor-pointer',
          separator && 'mr-2 after:absolute after:-right-1.5 after:top-0 after:bottom-0 after:block after:w-px after:bg-intents-ux-box-borderColor',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
        )}
        data-eid={generateClickEID('develop.preview.device_selector')}
      >
        {getIcon()}
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-[220px] p-1 max-h-[400px] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col">
          {/* Desktop/Full size */}
          {desktopDevices.map((device) => (
            <DeviceMenuItem
              key={device.id}
              device={device}
              displayName={getDeviceDisplayName(device)}
              isSelected={selectedDeviceId === device.id}
              onClick={() => handleDeviceSelect(device)}
            />
          ))}

          {/* Phones */}
          {phoneDevices.map((device) => (
            <DeviceMenuItem
              key={device.id}
              device={device}
              displayName={getDeviceDisplayName(device)}
              isSelected={selectedDeviceId === device.id}
              onClick={() => handleDeviceSelect(device)}
            />
          ))}

          {/* Tablets */}
          {tabletDevices.map((device) => (
            <DeviceMenuItem
              key={device.id}
              device={device}
              displayName={getDeviceDisplayName(device)}
              isSelected={selectedDeviceId === device.id}
              onClick={() => handleDeviceSelect(device)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface DeviceMenuItemProps {
  device: DevicePreset
  displayName: string
  isSelected: boolean
  onClick: () => void
}

function DeviceMenuItem({ device, displayName, isSelected, onClick }: DeviceMenuItemProps) {
  return (
    <button
      className={clsx(
        'flex items-center justify-between w-full px-2 py-1.5 text-left text-sm rounded',
        'hover:bg-intents-ux-boxHighContrast-backgroundColor/10',
        'focus:outline-none focus:bg-intents-ux-boxHighContrast-backgroundColor/10',
        isSelected && 'font-medium'
      )}
      onClick={onClick}
      data-eid={generateClickEID(`develop.preview.device_select_${device.id}`)}
    >
      <span>{displayName}</span>
      {isSelected && <CheckmarkIcon />}
    </button>
  )
}
