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
  trackFeedbackChattedPast,
  trackFeedbackResponse,
  trackFeedbackShown,
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

  it('trackCloseSelection fires click with color_scheme — 3-part EID (parseEID requires exactly 2 dots)', () => {
    trackCloseSelection('color_scheme', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.close_color_scheme',
      { appId: 'app123' }
    )
  })

  it('trackCloseSelection fires click with fonts', () => {
    trackCloseSelection('fonts', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.close_fonts',
      { appId: 'app123' }
    )
  })

  it('trackCloseSelection fires click with skipped', () => {
    trackCloseSelection('skipped', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.close_skipped',
      { appId: 'app123' }
    )
  })

  it('trackOffbaseAction fires click with submit — 3-part EID', () => {
    trackOffbaseAction('submit', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.offbase_submit',
      { appId: 'app123' }
    )
  })

  it('trackOffbaseAction fires click with skipped', () => {
    trackOffbaseAction('skipped', 'app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.offbase_skipped',
      { appId: 'app123' }
    )
  })

  it('trackFeedbackChattedPast rolls up under skipped EID with appId only (no timeToRespondMs)', () => {
    trackFeedbackChattedPast('app123')
    expect(mockLogClick).toHaveBeenCalledWith(
      'develop.first_build_feedback.skipped',
      { appId: 'app123' }
    )
  })
})
