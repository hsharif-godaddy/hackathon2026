'use client'

import SettingsPanelSkeleton, { DefaultSkeleton } from '@/app/[market]/develop/components/SettingsPanelSkeleton'
import StaticSkeleton from '@/app/[market]/develop/components/StaticSkeleton'
import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types'
import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'

const ANALYTICS_ROW_WIDTHS = [210, 180, 250, 165, 195, 220] as const

function AnalyticsUnpublishedSkeleton({ className }: { className?: string }) {
  return (
    <div className={`@container flex flex-col gap-4 ${className ?? ''}`.trim()}>
      <div className="bg-intents-ux-box-backgroundColor rounded-lg p-3 @md:p-4 @lg:p-6 flex flex-col items-center gap-4">
        <StaticSkeleton width="48px" height="48px" rounding="full" />
        <div className="flex flex-col items-center gap-4 w-full max-w-xl">
          <StaticSkeleton width="70%" height="22px" />
          <StaticSkeleton width="90%" height="16px" />
        </div>
        <StaticSkeleton width="120px" height="36px" className="rounded-md" />
      </div>
    </div>
  )
}

function AnalyticsPublishedSkeleton({ className }: { className?: string }) {
  return (
    <div className={`@container pb-2 px-1.5 md:px-0.5 flex flex-col gap-4 ${className ?? ''}`.trim()}>
      <div className="flex flex-col gap-3">
        <StaticSkeleton width="55%" height="22px" />
        <StaticSkeleton width="75%" height="16px" />
        <div className="flex justify-end">
          <StaticSkeleton width="140px" height="36px" className="rounded-md" />
        </div>
      </div>

      <div>
        <div className="flex justify-between border-b py-1">
          <StaticSkeleton width="200px" height="30px" className="rounded-md" />
          <StaticSkeleton width="30px" height="30px" className="rounded-md" />
        </div>
        <div className="grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-5 gap-2 py-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col justify-between rounded-lg border p-2 pt-2.5 bg-intents-ux-box-backgroundColor min-h-[76px]">
              <StaticSkeleton width="70%" height="10px" />
              <StaticSkeleton width="40%" height="24px" className="mt-auto" />
            </div>
          ))}
        </div>
        <div>
          {ANALYTICS_ROW_WIDTHS.map((width, i) => (
            <div key={i} className="flex justify-between border-b py-1">
              <StaticSkeleton width={`${width}px`} height="30px" className="rounded-md" />
              <StaticSkeleton width="30px" height="30px" className="rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function HistorySkeleton({ className }: { className?: string }) {
  return (
    <div className={`space-y-3 ${className ?? ''}`.trim()}>
      {[[1, 2], [3, 4, 5]].map((i) => (
        <div key={i[0]}>
          <StaticSkeleton width="30%" height="23px" className="mb-1 px-1" />
          <ul className="space-y-1">
            {i.map((j) => (
              <li key={j} className="space-y-1">
                <StaticSkeleton width="100%" height="65px" className="rounded-md" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function MediasSkeleton({ className }: { className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-3 px-3 md:px-0 pt-3 md:pt-0 ${className ?? ''}`.trim()}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="flex flex-col gap-1">
          <StaticSkeleton width="100%" height="100%" className="aspect-square rounded-md" />
          <StaticSkeleton width="80%" height="22px" />
        </div>
      ))}
    </div>
  )
}

export function AnalyticsPanelSkeleton() {
  return <PanelSkeleton panelType={ChatTab.ANALYTICS} isPublished={!!usePublishedUrl()} />
}

export default function PanelSkeleton({ panelType, settingsSection, className, isPublished }: { panelType?: ChatTab, settingsSection?: SettingsSection, className?: string, isPublished?: boolean }) {
  const skeleton = (() => {
    switch (panelType) {
      case ChatTab.MEDIAS:
        return <MediasSkeleton className={className} />
      case ChatTab.ANALYTICS:
        return isPublished
          ? <AnalyticsPublishedSkeleton className={className} />
          : <AnalyticsUnpublishedSkeleton className={className} />
      case ChatTab.HISTORY:
        return <HistorySkeleton className={className} />
      case ChatTab.SETTINGS:
        return <SettingsPanelSkeleton settingsSection={settingsSection} className={className} />
      default:
        return <DefaultSkeleton className={className} />
    }
  })()
  return <div data-testid="panel-skeleton">{skeleton}</div>
}
