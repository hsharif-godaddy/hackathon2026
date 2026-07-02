'use client'

import { useEffect } from 'react'

import { APP_GENERATION_FEEDBACK_BANNER_FLAG } from '@/app/[market]/develop/components/invocation-feedback';
import { useSwitchboard } from '@/hooks/useSwitchboard'
import {
  hasShownAppGenerationFeedback,
  markAppGenerationFeedbackShown,
} from '@/lib/app-generation-feedback-storage'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

/**
 * Decides when to show the app-generation feedback banner.
 *
 * Fires once per app when all of:
 *   - the `appbuilder-app-generation-feedback-banner` Switchboard flag is on
 *   - the initialization machine has seen the first meaningful file edit
 *     (`hasSeenFirstFileEdit`), i.e. the preview is worth showing
 *   - streaming has returned to idle (don't interrupt an in-flight turn)
 *   - the banner hasn't already been shown or submitted for this app
 *
 * Gating the flag here (rather than at render in ChatBanners) means we also
 * skip the `markAppGenerationFeedbackShown` localStorage write when the flag
 * is off — so apps generated during the pre-rollout window can still see the
 * banner after the flag flips on, instead of being permanently suppressed.
 *
 * Trace IDs are attached when the complete event carried them (so the
 * feedback event stitches to the Langfuse trace), but they're not required
 * for the banner to show — without them the event still records appId,
 * feedback, and agent context, it just doesn't link to a specific turn.
 *
 * The localStorage guard keeps the banner from reappearing on reload or
 * subsequent visits.
 */
export function useAppGenerationFeedbackTrigger(hasSeenFirstFileEdit: boolean): void {
  const flagEnabled = useSwitchboard(APP_GENERATION_FEEDBACK_BANNER_FLAG) ?? false
  const streamingState = useStreamingConversationStore((s) => s.streamingState)
  const appId = useDevelopPageStore((s) => s.currentAppId)
  const lastCompleteTraceIds = useDevelopPageStore((s) => s.lastCompleteTraceIds)
  const showAppGenerationFeedbackBanner = useDevelopPageStore((s) => s.showAppGenerationFeedbackBanner)
  const appGenerationFeedbackSubmitted = useDevelopPageStore((s) => s.appGenerationFeedbackSubmitted)
  const setShowAppGenerationFeedbackBanner = useDevelopPageStore((s) => s.setShowAppGenerationFeedbackBanner)

  useEffect(() => {
    if (!flagEnabled) return
    if (!hasSeenFirstFileEdit) return
    if (streamingState !== 'idle') return
    if (!appId) return
    if (showAppGenerationFeedbackBanner || appGenerationFeedbackSubmitted) return
    if (hasShownAppGenerationFeedback(appId)) return

    setShowAppGenerationFeedbackBanner(true, lastCompleteTraceIds)
    markAppGenerationFeedbackShown(appId)
  }, [
    flagEnabled,
    hasSeenFirstFileEdit,
    streamingState,
    appId,
    lastCompleteTraceIds,
    showAppGenerationFeedbackBanner,
    appGenerationFeedbackSubmitted,
    setShowAppGenerationFeedbackBanner,
  ])
}
