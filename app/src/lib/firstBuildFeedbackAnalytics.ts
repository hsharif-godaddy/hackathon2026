import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

const SECTION = 'develop.first_build_feedback'

export function trackFeedbackShown(appId: string): void {
  logImpressionEvent(`${SECTION}.prompt`, { appId })()
}

export function trackFeedbackResponse(
  response: 'magical' | 'close' | 'offbase' | 'skipped',
  shownAt: number,
  appId: string,
): void {
  logClickEvent(`${SECTION}.${response}`, {
    appId,
    timeToRespondMs: Date.now() - shownAt,
  })()
}

export function trackFollowupResponse(
  step: 'close_followup' | 'offbase_followup',
  hadChipSelection: boolean,
  appId: string,
): void {
  logClickEvent(`${SECTION}.${step}.submit`, { appId, hadChipSelection })()
}

export const CLOSE_CHIP_MAP: Record<number, 'color_scheme' | 'fonts' | 'tone'> = {
  0: 'color_scheme',
  1: 'fonts',
  2: 'tone',
}

export function trackCloseSelection(
  selection: 'color_scheme' | 'fonts' | 'tone' | 'other' | 'skipped',
  appId: string,
): void {
  logClickEvent(`${SECTION}.close.${selection}`, { appId })()
}

export function trackOffbaseAction(
  action: 'submit' | 'skipped',
  appId: string,
): void {
  logClickEvent(`${SECTION}.offbase.${action}`, { appId })()
}
