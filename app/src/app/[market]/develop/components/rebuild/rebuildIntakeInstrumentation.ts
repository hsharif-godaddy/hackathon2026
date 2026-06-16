import type { DesignDirection, RebuildScope } from '@/app/[market]/develop/hooks/useRebuildIntake'
import { getInstrumentationAppId, logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

export type RebuildIntakeDesignChoiceId =
  | 'airo_decide'
  | 'keep_similar'
  | 'modernize'
  | 'simplify'
  | 'bold'

export type RebuildIntakeSubmitSource = 'submit' | 'defaults' | 'timeout'

export type RebuildIntakeFormErrorReason = 'fetch_failed' | 'empty_estimates'

const loggedIntakeTimeouts = new Set<string>()

function intakeTimeoutDedupeKey(sourceUrl: string): string {
  return `${getInstrumentationAppId() ?? ''}:${sourceUrl}`
}

export function trackRebuildIntakeWaiting(sourceUrl: string) {
  logImpressionEvent('develop.rebuild.intakewaiting', { sourceUrl })()
}

export function trackRebuildIntakeFormShown(sourceUrl: string) {
  logImpressionEvent('develop.rebuild.intakeform', { sourceUrl })()
}

export function trackRebuildIntakeFormError(sourceUrl: string, reason: RebuildIntakeFormErrorReason) {
  logImpressionEvent('develop.rebuild.intakeform.error', { sourceUrl, reason })()
}

export function trackRebuildIntakeTimedOut(sourceUrl: string) {
  const key = intakeTimeoutDedupeKey(sourceUrl)
  if (loggedIntakeTimeouts.has(key)) return
  loggedIntakeTimeouts.add(key)
  logImpressionEvent('develop.rebuild.intaketimeout', {
    scope: 'homepage_only',
    designChoice: 'modernize',
    designDirection: 'modernize',
    submitSource: 'timeout',
    sourceUrl,
  })()
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

/** Homepage "Rebuild my site" chip opened the upfront design-direction modal. */
export function trackRebuildDesignModalShown() {
  logImpressionEvent('homepage.rebuild.designmodal')()
}

/** User picked a design direction in the homepage rebuild modal. */
export function trackRebuildDesignModalChoice(designDirection: DesignDirection) {
  logClickEvent('homepage.rebuild.designchoice', { designDirection })()
}

/** Homepage opened the rebuild modal from a Switchers deep link. */
export function trackRebuildDeeplinkShown(designDirection?: DesignDirection) {
  logImpressionEvent('homepage.rebuild.deeplink', {
    ...(designDirection && { designDirection }),
  })()
}
