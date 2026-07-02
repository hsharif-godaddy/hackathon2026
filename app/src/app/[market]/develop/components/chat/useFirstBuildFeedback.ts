import { useCallback, useEffect, useMemo, useState } from 'react'

import { useJtbdFeedbackRevealSignal } from '@/app/[market]/develop/hooks/useInitialBuildRevealSignals'
import { SWITCHBOARD_APPBUILDER_FIRST_BUILD_FEEDBACK } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { isLogoDesignerApp } from '@/lib/logo-designer-preview-switch-storage'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { safeGetItem, safeSetItem } from '@/utils/localStorage'

export type FeedbackStep = 'prompt' | 'close_followup' | 'offbase_followup'
type DismissReason = 'magical' | 'close' | 'offbase' | 'skipped' | 'chatted-past'

export interface UseFirstBuildFeedbackResult {
  step: FeedbackStep
  advance: (to: Exclude<FeedbackStep, 'prompt'>) => void
  dismiss: (reason: DismissReason) => void
}

export function useFirstBuildFeedback(appId: string): UseFirstBuildFeedbackResult | null {
  const flagEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_FIRST_BUILD_FEEDBACK)
  const initialBuildComplete = useDevelopPageStore(
    (s) => s.app?.id === appId ? s.app?.initialBuildComplete : undefined,
  )
  const { firstFileEdit } = useJtbdFeedbackRevealSignal(appId)
  const [step, setStep] = useState<FeedbackStep | 'done'>('prompt')

  useEffect(() => {
    setStep('prompt')
  }, [appId])

  // Snapshotted at mount (re-read only on app change) so an in-session `advance`
  // write can't hide the in-progress follow-up; on reload it keeps an
  // already-engaged survey from re-appearing.
  const readResolved = useCallback(
    (): boolean =>
      Boolean(
        safeGetItem(`fbf_answered_${appId}`) ||
          safeGetItem(`fbf_skipped_${appId}`) ||
          safeGetItem(`fbf_responded_${appId}`)
      ),
    [appId],
  )
  const [alreadyResolved, setAlreadyResolved] = useState<boolean>(readResolved)
  useEffect(() => {
    setAlreadyResolved(readResolved())
  }, [readResolved])

  // `initialBuildComplete` is only an optimistic in-session flag (the refetched
  // agent record can come back false on reload), so persist that the survey was
  // shown and treat that as an equivalent signal to re-show it after a refresh.
  // Only written once all other gates have passed, so it can't bypass deferral.
  const wasShown: boolean = useMemo(
    () => Boolean(safeGetItem(`fbf_shown_${appId}`)),
    [appId],
  )

  const advance = useCallback(
    (to: Exclude<FeedbackStep, 'prompt'>) => {
      // A rating selection answers the main question (analytics fire on click);
      // persist it so a refresh mid-follow-up doesn't re-prompt.
      safeSetItem(`fbf_responded_${appId}`, 'true')
      setStep(to)
    },
    [appId],
  )

  const dismiss = useCallback(
    (reason: DismissReason) => {
      if (reason === 'magical' || reason === 'close' || reason === 'offbase') {
        safeSetItem(`fbf_answered_${appId}`, reason)
      } else if (reason === 'skipped' || reason === 'chatted-past') {
        // chatted-past is an implicit skip: persist it like the Skip button so the
        // panel stays resolved and the skipped event fires at most once per app.
        safeSetItem(`fbf_skipped_${appId}`, 'true')
      }
      setStep('done')
    },
    [appId],
  )

  const shouldShow: boolean =
    Boolean(flagEnabled) &&
    (Boolean(initialBuildComplete) || wasShown) &&
    firstFileEdit &&
    !alreadyResolved &&
    step !== 'done' &&
    !isLogoDesignerApp(appId)

  useEffect(() => {
    if (shouldShow && !wasShown) {
      safeSetItem(`fbf_shown_${appId}`, 'true')
    }
  }, [shouldShow, wasShown, appId])

  // Re-check `step` (already covered by `shouldShow`) so TS narrows the union.
  if (!shouldShow || step === 'done') {
    return null
  }

  return { step, advance, dismiss }
}
