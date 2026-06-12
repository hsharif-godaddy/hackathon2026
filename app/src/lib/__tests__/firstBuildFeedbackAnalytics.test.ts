import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogClick = vi.fn()
const mockLogImpression = vi.fn()

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: (eid: string, props?: object) => {
    mockLogClick(eid, props)
    return () => {}
  },
  logImpressionEvent: (eid: string, props?: object) => {
    mockLogImpression(eid, props)
    return () => {}
  },
}))

import {
  trackCloseSelection,
  trackFeedbackResponse,
  trackFeedbackShown,
  trackFollowupResponse,
  trackOffbaseAction,
} from '../firstBuildFeedbackAnalytics'

describe('firstBuildFeedbackAnalytics', () => {
  beforeEach(() => {
    mockLogClick.mockReset()
    mockLogImpression.mockReset()
  })

  it('trackFeedbackShown fires impression with appId', () => {
    trackFeedbackShown('app123')
    expect(mockLogImpression).toHaveBeenCalledWith(
      'develop.first_build_feedback.prompt',
      { appId: 'app123' }
    )
  })

  it('trackFeedbackResponse fires click with response and timeToRespondMs', () => {
    const shownAt = Date.now() - 3000
    trackFeedbackResponse('magical', shownAt, 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.magical',
      expect.objectContaining({ appId: 'app123', timeToRespondMs: expect.any(Number) })
    )
  })

  it('trackFollowupResponse fires click with step and hadChipSelection', () => {
    trackFollowupResponse('close_followup', true, 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.close_followup.submit',
      { appId: 'app123', hadChipSelection: true }
    )
  })

  it('trackCloseSelection fires click with color_scheme selection', () => {
    trackCloseSelection('color_scheme', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.close.color_scheme',
      { appId: 'app123' }
    )
  })

  it('trackCloseSelection fires click with skipped selection', () => {
    trackCloseSelection('skipped', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.close.skipped',
      { appId: 'app123' }
    )
  })

  it('trackOffbaseAction fires click with submit action', () => {
    trackOffbaseAction('submit', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.offbase.submit',
      { appId: 'app123' }
    )
  })

  it('trackOffbaseAction fires click with skipped action', () => {
    trackOffbaseAction('skipped', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.offbase.skipped',
      { appId: 'app123' }
    )
  })
})
