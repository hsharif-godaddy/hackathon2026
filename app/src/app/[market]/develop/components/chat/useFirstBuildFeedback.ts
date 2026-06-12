import { useCallback, useEffect, useMemo, useState } from 'react'

import { SWITCHBOARD_APPBUILDER_FIRST_BUILD_FEEDBACK } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'
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
      } else if (reason === 'skipped') {
        safeSetItem(`fbf_skipped_${appId}`, 'true')
      }
      // 'chatted-past' writes nothing — re-shows on refresh
      setStep('done')
    },
    [appId],
  )

  if (!flagEnabled || !initialBuildComplete || alreadyResolved || step === 'done') {
    return null
  }

  return { step, advance, dismiss }
}
