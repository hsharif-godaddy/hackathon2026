'use client'

import clsx from 'clsx'

import { getDevicePreset } from '@/app/[market]/develop/components/preview/devicePresets'
import Tips from '@/app/[market]/develop/components/tips/Tips'
import { PreviewViewMode } from '@/app/[market]/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface PreviewLoadingStateProps {
  message: string
  description?: string
  isMobile?: boolean
  testId?: string
  timeEstimateMinutes?: number | null
  onTimeEstimateShown?: () => void
}

export default function PreviewLoadingState({ message, description, isMobile = false, testId, timeEstimateMinutes = null, onTimeEstimateShown }: PreviewLoadingStateProps) {
  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const selectedDeviceId = useDevelopPageStore((state) => state.selectedDeviceId)

  const selectedDevice = getDevicePreset(selectedDeviceId)
  const isFullSize = previewViewMode === PreviewViewMode.DESKTOP || selectedDeviceId === 'full'

  const deviceWidth = selectedDevice?.width || 0
  const deviceHeight = selectedDevice?.height || 0

  // Range: 4px for tallest (1366px) to 32px for shortest (667px)
  const minHeight = 667
  const maxHeight = 1366
  const clampedHeight = Math.max(minHeight, Math.min(maxHeight, deviceHeight))
  const deviceVerticalMargin = Math.round(32 - ((clampedHeight - minHeight) / (maxHeight - minHeight)) * 28)

  return (
    <div className="h-full flex flex-col pe-1 md:pe-2.5 ps-1" data-testid={testId}>
      <div className="inset-0 relative h-full">
        <div className="flex flex-col items-center justify-center h-full bg-intents-ux-boxLowContrast-backgroundColor rounded-lg md:rounded-b-none">
          <div className="flex-1 flex items-center justify-center pb-1 md:pb-0 px-1 md:px-0 w-full">
            <div
              className={clsx(
                'relative border rounded-lg md:rounded-b-none bg-intents-ux-boxLowContrast-backgroundColor w-full h-full overflow-hidden',
                {
                  'w-full h-full': isFullSize || isMobile,
                  'my-auto': !isFullSize && !isMobile
                }
              )}
              style={!isFullSize && !isMobile ? {
                width: `${deviceWidth}px`,
                height: `min(${deviceHeight}px, calc(100% - ${deviceVerticalMargin * 2}px))`
              } : undefined}
            >
              <Tips buildingMessage={message} buildingDescription={description} timeEstimateMinutes={timeEstimateMinutes} onTimeEstimateShown={onTimeEstimateShown} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
