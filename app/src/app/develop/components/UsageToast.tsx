'use client'

import { useEffect, useState } from 'react'
import Alert from '@ux/alert'
import Button from '@ux/button'
import text from '@ux/text'

import { ChatTab, SettingsSection } from '@/app/develop/components/types'
import { useChatTabs } from '@/hooks/useChatTabs'
import { formatResetTime, TOAST_THRESHOLD } from '@/hooks/useDailyUsage'
import { useTranslations } from '@/hooks/useTranslations'

interface UsageWarningEvent {
  percentage: number
  resetTime: string | null
}

export default function UsageToast() {
  const t = useTranslations()
  const [visible, setVisible] = useState(false)
  const [percentage, setPercentage] = useState<number>(TOAST_THRESHOLD)
  const [resetTime, setResetTime] = useState<string | null>(null)
  const { setActiveChatTab, setActiveSettingsSection } = useChatTabs()

  useEffect(() => {
    const handleWarning = (event: CustomEvent<UsageWarningEvent>) => {
      const { percentage: pct, resetTime: rt } = event.detail
      setPercentage(pct)
      setResetTime(formatResetTime(rt))
      setVisible(true)

      setTimeout(() => setVisible(false), 8000)
    }

    window.addEventListener('usage-warning', handleWarning as EventListener)
    return () => window.removeEventListener('usage-warning', handleWarning as EventListener)
  }, [])

  const handleViewDetails = () => {
    setActiveSettingsSection(SettingsSection.PROJECT)
    setActiveChatTab(ChatTab.SETTINGS)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed top-16 right-4 z-50 w-80">
      <Alert emphasis="warning" onClose={() => setVisible(false)}>
        <text.strong text={t('builder_usage_toast_title', { percentage: String(Math.round(percentage)) }, "You've used {percentage}% of your daily usage")} />
        {resetTime && (
          <text.p text={t('builder_usage_toast_message', { time: resetTime }, `Your usage resets ${resetTime}.`)} />
        )}
        <Button design="inline" onClick={handleViewDetails}>
          {t('builder_usage_toast_view_details', void 0, 'View details')}
        </Button>
      </Alert>
    </div>
  )
}
