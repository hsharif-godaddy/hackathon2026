'use client'

import { useEffect, useRef, useState } from 'react'
import ThumbsDownIcon from '@ux/icon/thumbs-down'
import ThumbsUpIcon from '@ux/icon/thumbs-up'

import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'
import type { FeedbackValue } from '@/lib/feedback-client'
import { submitFeedback } from '@/lib/feedback-client'
import { shipAnalyticsLog } from '@/lib/logging'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

export default function AppGenerationFeedbackBanner() {
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)
  const [thanks, setThanks] = useState(false)
  const hasLoggedImpressionRef = useRef(false)

  const traceIds = useDevelopPageStore((s) => s.appGenerationFeedbackTraceIds)
  const appId = useDevelopPageStore((s) => s.currentAppId)
  const markSubmitted = useDevelopPageStore((s) => s.markAppGenerationFeedbackSubmitted)
  const setShowBanner = useDevelopPageStore((s) => s.setShowAppGenerationFeedbackBanner)

  useEffect(() => {
    if (hasLoggedImpressionRef.current) return
    logImpressionEvent('appGeneration.feedback.view')()
    hasLoggedImpressionRef.current = true
  }, [])

  useEffect(() => {
    if (!thanks) return
    const timer = setTimeout(() => {
      markSubmitted()
    }, 2000)
    return () => clearTimeout(timer)
  }, [thanks, markSubmitted])

  const handleClose = () => {
    logClickEvent('appGeneration.feedback.close')()
    setShowBanner(false, null)
  }

  const handleVote = async (feedback: FeedbackValue) => {
    if (submitting || thanks) return
    if (!appId) {
      // Shouldn't happen — trigger hook guards on this. Fail closed.
      setShowBanner(false, null)
      return
    }

    logClickEvent(`appGeneration.feedback.${feedback}`)()
    setSubmitting(true)

    // Trace IDs are best-effort: when the complete event carried them the
    // feedback event stitches to the Langfuse trace; when it didn't (e.g.
    // OTel instrumentation not configured locally) we still capture the
    // signal, just without the trace link.
    const { ok, reason } = await submitFeedback({
      feedback,
      // The rated thing is the generated app — artifact-level feedback.
      // targetId is the appId since that's the stable artifact identifier
      // we have client-side.
      targetLevel: 'artifact',
      targetId: appId,
      appId,
      ...(traceIds?.traceId && { traceId: traceIds.traceId }),
      ...(traceIds?.observationId && { observationId: traceIds.observationId }),
      ...(traceIds?.agentName && { agentName: traceIds.agentName }),
    })

    // Missing conversationId means the WS cookie flow broke upstream — close
    // rather than submit with incomplete context. Still counts as shown via
    // the localStorage guard so the user isn't re-nagged next page load.
    if (!ok && reason === 'missing_conversation_id') {
      setShowBanner(false, null)
      setSubmitting(false)
      return
    }

    shipAnalyticsLog('appGeneration.feedback.submit', {
      appId,
      feedback,
      ...(traceIds?.traceId && { traceId: traceIds.traceId }),
      ...(traceIds?.observationId && { observationId: traceIds.observationId }),
      outcome: ok ? 'success' : 'failure',
    })

    setThanks(true)
    setSubmitting(false)
  }

  if (thanks) {
    return (
      <ChatBanner variant="success" className="app-generation-feedback-banner--thanks">
        <span data-testid="app-generation-feedback-thanks">
          {t('builder_app_generation_feedback_thanks')}
        </span>
      </ChatBanner>
    )
  }

  return (
    <ChatBanner variant="info" onClose={handleClose}>
      <span
        data-testid="app-generation-feedback-banner"
        className="flex items-center gap-2"
      >
        <span className="flex-1">{t('builder_app_generation_feedback_prompt')}</span>
        <button
          type="button"
          aria-label="Positive feedback"
          data-testid="app-generation-feedback-thumbs-up"
          className="cursor-pointer disabled:opacity-50"
          onClick={() => handleVote('positive')}
          disabled={submitting}
        >
          <ThumbsUpIcon />
        </button>
        <button
          type="button"
          aria-label="Negative feedback"
          data-testid="app-generation-feedback-thumbs-down"
          className="cursor-pointer disabled:opacity-50"
          onClick={() => handleVote('negative')}
          disabled={submitting}
        >
          <ThumbsDownIcon />
        </button>
      </span>
    </ChatBanner>
  )
}
