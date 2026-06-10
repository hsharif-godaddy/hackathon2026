import type { DesignDirection, RebuildScope } from '@/app/[market]/develop/hooks/useRebuildIntake'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

export type RebuildIntakeDesignChoiceId =
  | 'airo_decide'
  | 'keep_similar'
  | 'modernize'
  | 'simplify'
  | 'bold'

export type RebuildIntakeSubmitSource = 'submit' | 'defaults'

export function trackRebuildIntakeFormShown(sourceUrl: string) {
  logImpressionEvent('develop.rebuild.intakeform', { sourceUrl })()
}

export function trackRebuildIntakeSubmitted({
  scope,
  designChoice,
  designDirection,
  submitSource,
  sourceUrl,
}: {
  scope: RebuildScope
  designChoice: RebuildIntakeDesignChoiceId
  designDirection: DesignDirection
  submitSource: RebuildIntakeSubmitSource
  sourceUrl: string
}) {
  const eid = submitSource === 'defaults' ? 'develop.rebuild.intakedefaults' : 'develop.rebuild.intakesubmit'
  logClickEvent(eid, {
    scope,
    designChoice,
    designDirection,
    submitSource,
    sourceUrl,
  })()
}
