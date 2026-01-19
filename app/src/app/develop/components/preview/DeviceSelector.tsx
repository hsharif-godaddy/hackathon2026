'use client'

import clsx from 'clsx'
import { useState } from 'react'
import CheckmarkIcon from '@ux/icon/checkmark'
import ChevronDownIcon from '@ux/icon/chevron-down'
import DesktopIcon from '@ux/icon/desktop'
import MobilePhoneIcon from '@ux/icon/mobile-phone'

import { PreviewViewMode } from '@/app/develop/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { generateClickEID } from '@/utils/instrumentation'

import { getDevicePreset, getDevicesByCategory, type DevicePreset } from './devicePresets'

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

  const selectedDevice = getDevicePreset(selectedDeviceId)

  // Translate "Full size" for the 'full' device, use device.name for others
  function getDeviceDisplayName(device: DevicePreset): string {
    return device.id === 'full' ? t('builder_device_full_size', undefined, 'Full size') : device.name
  }

  const displayName = selectedDevice ? getDeviceDisplayName(selectedDevice) : t('builder_device_full_size', undefined, 'Full size')

  function handleDeviceSelect(device: DevicePreset) {
    setSelectedDeviceId(device.id)

    // Only update preview mode if it's actually changing
    // This prevents resetting the device ID when switching between devices of the same category
    if (previewViewMode !== device.category) {
      setPreviewViewMode(device.category)
    }

    setOpen(false)
  }

  function getIcon() {
    if (previewViewMode === PreviewViewMode.MOBILE) {
      return <MobilePhoneIcon />
    }
    return <DesktopIcon />
  }

  // Only show device name text when in full size desktop mode
  const showDeviceName = previewViewMode === PreviewViewMode.DESKTOP

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
        {showDeviceName && <span>{displayName}</span>}
        {showDeviceName && <ChevronDownIcon className="opacity-50" />}
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
      data-eid={generateClickEID(`develop.preview.device_select.${device.id}`)}
    >
      <span>{displayName}</span>
      {isSelected && <CheckmarkIcon />}
    </button>
  )
}
