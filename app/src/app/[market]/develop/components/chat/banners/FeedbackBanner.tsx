'use client'

import { useEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'

import { FEEDBACK_ID } from '@/components/feedback/utils'
import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

export default function FeedbackBanner() {
  const t = useTranslations()
  const [isDismissed, setIsDismissed] = useState(false)
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal)
  const hasLoggedImpressionRef = useRef(false)

  useEffect(() => {
    if (!isDismissed && !hasLoggedImpressionRef.current) {
      logImpressionEvent('chat.feedbackBanner.view')()
      hasLoggedImpressionRef.current = true
    }
  }, [isDismissed])

  if (isDismissed) {
    return null
  }

  const handleClose = () => {
    logClickEvent('chat.feedbackBanner.close')()
    setIsDismissed(true)
  }

  const handleFeedbackClick = (e: React.MouseEvent) => {
    e.preventDefault()
    logClickEvent('chat.feedbackBanner.feedback')()
    localStorage.removeItem(`airo-feedback-shown:${FEEDBACK_ID}`)
    openFeedbackModal(FEEDBACK_ID, 'Session feedback', 'feedback')
    setIsDismissed(true)
  }

  const link = (
    <a href="#" className="underline !cursor-pointer !normal-case" onClick={handleFeedbackClick}>
      {t('builder_feedback_banner_link')}
    </a>
  )

  return (
    <ChatBanner variant="info" onClose={handleClose}>
      <FormattedMessage
        id="builder_feedback_banner_message"
        values={{ link }}
      />
    </ChatBanner>
  )
}
