'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import CalendarIcon from '@ux/icon/calendar'

import MarketingCanvasPane from '@/app/[market]/develop/components/settings/Campaigns/MarketingCanvasPane'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import ContentCalendar from '@/app/[market]/develop/components/settings/Marketing/ContentCalendar'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderCanvasTabsEnabled } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

export default function MarketingPanel() {
  const t = useTranslations()
  const router = useRouter()
  const appId = useAppIdFromParams()
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled()
  const marketingView = useDevelopPageStore((state) => state.marketingView)
  const [isCalendarLoading, setIsCalendarLoading] = useState(true)

  // Track whether the user entered via a campaign flow ("See Details").
  // Resets when the panel unmounts (user switched to a different canvas tab
  // and came back), so the calendar view is the default landing state.
  const [inCampaignFlow, setInCampaignFlow] = useState(isCanvasTabsEnabled && marketingView === 'detail')

  if (!appId) {
    return (
      <EmptyStateCard
        icon={<CalendarIcon width={48} height={48} />}
        title={t('builder_marketing_no_app_selected')}
        description={t('builder_marketing_no_app_description')}
        ctaLabel={t('builder_marketing_go_to_apps')}
        onCtaClick={() => router.push('/')}
      />
    )
  }

  // In canvas-tabs mode, delegate list/detail orchestration entirely to
  // MarketingCanvasPane when the user entered via a campaign flow.
  if (isCanvasTabsEnabled && (inCampaignFlow || marketingView === 'detail')) {
    return (
      <MarketingCanvasPane onBack={() => setInCampaignFlow(false)} />
    )
  }

  return (
    <>
      {isCalendarLoading && (
        <SettingsLoadingState
          fullPage
          title={t('builder_marketing_loading_calendar')}
        />
      )}
      <div className={isCalendarLoading ? 'hidden' : undefined}>
        <SettingsSection
          title={t('builder_marketing_calendar')}
          description={t('builder_marketing_calendar_description')}
          className="min-w-[340px]"
        >
          <ContentCalendar appId={appId} onLoadingChange={setIsCalendarLoading} />
        </SettingsSection>
      </div>
    </>
  )
}
