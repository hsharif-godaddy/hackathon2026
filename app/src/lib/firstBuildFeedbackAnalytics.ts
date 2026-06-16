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

// parseEID enforces exactly 2 dots (3 parts). Keep all EIDs as product.section.widget.
// Close chip selections: develop.first_build_feedback.close_{selection}
// Offbase actions:       develop.first_build_feedback.offbase_{action}

export const CLOSE_CHIP_MAP: Record<number, 'color_scheme' | 'fonts' | 'tone'> = {
  0: 'color_scheme',
  1: 'fonts',
  2: 'tone',
}

export function trackCloseSelection(
  selection: 'color_scheme' | 'fonts' | 'tone' | 'other' | 'skipped',
  appId: string,
): void {
  logClickEvent(`${SECTION}.close_${selection}`, { appId })()
}

export function trackOffbaseAction(
  action: 'submit' | 'skipped',
  appId: string,
): void {
  logClickEvent(`${SECTION}.offbase_${action}`, { appId })()
}
