import { describe, expect, it } from 'vitest'

import { THINKING_TIPS } from '@/app/[market]/develop/components/chat/thinking-tips-content'
import { thinkingTipsContent } from './tips-content'

describe('tips-content', function packageTests() {
  describe('thinkingTipsContent', function thinkingTips() {
    it('excludes the logo tip from post-build thinking rotation', function noLogoTip() {
      expect(thinkingTipsContent).not.toContain('builder_tips_logo_description')
    })

    it('keeps enough tips for ThinkingTip rotation', function rotationPool() {
      expect(thinkingTipsContent.length).toBeGreaterThanOrEqual(2)
    })

    it('matches THINKING_TIPS re-export', function reexport() {
      expect(THINKING_TIPS).toEqual(thinkingTipsContent)
    })
  })
})
