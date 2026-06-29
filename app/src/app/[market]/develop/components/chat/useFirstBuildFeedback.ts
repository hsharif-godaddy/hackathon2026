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

  const alreadyResolved = useMemo(
    () =>
      Boolean(
        safeGetItem(`fbf_answered_${appId}`) || safeGetItem(`fbf_skipped_${appId}`)
      ),
    [appId],
  )

  const advance = useCallback(
    (to: Exclude<FeedbackStep, 'prompt'>) => setStep(to),
    [],
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

  if (
    !flagEnabled ||
    !initialBuildComplete ||
    !firstFileEdit ||
    alreadyResolved ||
    step === 'done' ||
    isLogoDesignerApp(appId)
  ) {
    return null
  }

  return { step, advance, dismiss }
}
