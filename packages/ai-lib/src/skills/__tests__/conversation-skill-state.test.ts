import { describe, it, expect, beforeEach } from 'vitest'
import { ConversationSkillState } from '../conversation-skill-state.js'

describe('ConversationSkillState', () => {
  let state: ConversationSkillState

  beforeEach(() => {
    state = new ConversationSkillState()
  })

  describe('activate', () => {
    it('should activate a skill for a conversation', () => {
      state.activate('conv-1', 'blog', 5)

      const activeSkills = state.getActiveSkills('conv-1')
      expect(activeSkills.has('blog')).toBe(true)
      expect(activeSkills.get('blog')?.lastUsedStep).toBe(5)
    })

    it('should reset lastUsedStep when activating an already active skill', () => {
      state.activate('conv-1', 'blog', 5)
      state.activate('conv-1', 'blog', 10)

      const activeSkills = state.getActiveSkills('conv-1')
      expect(activeSkills.get('blog')?.lastUsedStep).toBe(10)
    })
  })

  describe('deactivate', () => {
    it('should deactivate a skill', () => {
      state.activate('conv-1', 'blog', 5)
      state.deactivate('conv-1', 'blog')

      const activeSkills = state.getActiveSkills('conv-1')
      expect(activeSkills.has('blog')).toBe(false)
    })
  })

  describe('updateLastUsed', () => {
    it('should update lastUsedStep for a skill', () => {
      state.activate('conv-1', 'blog', 5)
      state.updateLastUsed('conv-1', 'blog', 15)

      const activeSkills = state.getActiveSkills('conv-1')
      expect(activeSkills.get('blog')?.lastUsedStep).toBe(15)
    })
  })

  describe('getActiveToolNames', () => {
    it('should return prefixed tool names for active skills', () => {
      state.activate('conv-1', 'blog', 5)
      state.setSkillTools('blog', ['createPost', 'listPosts'])

      const toolNames = state.getActiveToolNames('conv-1')
      expect(toolNames).toContain('blog__createPost')
      expect(toolNames).toContain('blog__listPosts')
    })
  })

  describe('cleanupInactiveSkills', () => {
    it('should deactivate skills inactive for more than threshold steps', () => {
      state.activate('conv-1', 'blog', 5)
      state.activate('conv-1', 'seo', 12)

      const deactivated = state.cleanupInactiveSkills('conv-1', 20, 10)

      expect(deactivated).toContain('blog') // 20 - 5 = 15 > 10
      expect(deactivated).not.toContain('seo') // 20 - 12 = 8 < 10
    })
  })
})
