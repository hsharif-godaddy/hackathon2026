// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  hasShownAppGenerationFeedback,
  markAppGenerationFeedbackShown,
} from './app-generation-feedback-storage'

describe('app-generation-feedback-storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns false before the banner is marked shown', () => {
    expect(hasShownAppGenerationFeedback('app-1')).toBe(false)
  })

  it('returns true after marking shown for that app only', () => {
    markAppGenerationFeedbackShown('app-1')
    expect(hasShownAppGenerationFeedback('app-1')).toBe(true)
    expect(hasShownAppGenerationFeedback('app-2')).toBe(false)
  })

  it('writes the expected localStorage key', () => {
    markAppGenerationFeedbackShown('abc123')
    expect(window.localStorage.getItem('airo-app-generation-feedback-shown:abc123')).toBe('true')
  })
})
