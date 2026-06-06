import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SkillToolManager } from '../skill-tool-manager'

vi.mock('../../database/repositories/index.js', () => ({
  appRepository: { findById: vi.fn().mockReturnValue(null) },
}));

vi.mock('../../logging/index.js');
vi.mock('../../workspace/index.js');

describe('Skill Tool Integration', () => {
  let manager: SkillToolManager

  beforeEach(() => {
    manager = new SkillToolManager()
  })

  describe('step-based activation', () => {
    it('should activate skill and make tools available via getActiveToolNames', () => {
      // Set up skill tools first (simulating pre-registration)
      manager['conversationState'].setSkillTools('blog', ['createPost', 'listPosts'])

      // Activate the skill
      manager.activateSkill('conv-1', 'blog', 1)

      const toolNames = manager.getActiveToolNames('conv-1')

      expect(toolNames).toContain('blog__createPost')
      expect(toolNames).toContain('blog__listPosts')
    })

    it('should update usage and prevent inactivity cleanup', () => {
      manager['conversationState'].setSkillTools('blog', ['createPost'])
      manager.activateSkill('conv-1', 'blog', 1)

      // Use the tool at step 8
      manager.updateSkillUsage('conv-1', 'blog', 8)

      // At step 15, blog should still be active (15 - 8 = 7 < 10)
      const deactivated = manager.cleanupInactiveSkills('conv-1', 15)

      expect(deactivated).not.toContain('blog')
      expect(manager.getActiveToolNames('conv-1')).toContain('blog__createPost')
    })

    it('should cleanup skills inactive for more than 30 steps', () => {
      manager['conversationState'].setSkillTools('blog', ['createPost'])
      manager.activateSkill('conv-1', 'blog', 1)

      // At step 35, blog should be deactivated (35 - 1 = 34 > 30)
      const deactivated = manager.cleanupInactiveSkills('conv-1', 35)

      expect(deactivated).toContain('blog')
      expect(manager.getActiveToolNames('conv-1')).not.toContain('blog__createPost')
    })
  })

  describe('tool filtering for prepareStep', () => {
    it('should only return active skill tools', () => {
      // Set up tools for both skills
      manager['conversationState'].setSkillTools('blog', ['createPost'])
      manager['conversationState'].setSkillTools('seo', ['analyze'])

      // Activate only blog
      manager.activateSkill('conv-1', 'blog', 1)

      const toolNames = manager.getActiveToolNames('conv-1')

      expect(toolNames).toContain('blog__createPost')
      expect(toolNames).not.toContain('seo__analyze')
    })

    it('should return empty array for conversation with no active skills', () => {
      const toolNames = manager.getActiveToolNames('conv-no-skills')
      expect(toolNames).toEqual([])
    })
  })

  describe('multiple skills per conversation', () => {
    it('should track multiple active skills independently', () => {
      manager['conversationState'].setSkillTools('blog', ['createPost'])
      manager['conversationState'].setSkillTools('seo', ['analyze'])

      manager.activateSkill('conv-1', 'blog', 1)
      manager.activateSkill('conv-1', 'seo', 25)

      // At step 35: blog inactive (34 > 30), seo active (10 steps, not > 30)
      const deactivated = manager.cleanupInactiveSkills('conv-1', 35)

      expect(deactivated).toContain('blog')
      expect(deactivated).not.toContain('seo')

      const toolNames = manager.getActiveToolNames('conv-1')
      expect(toolNames).not.toContain('blog__createPost')
      expect(toolNames).toContain('seo__analyze')
    })
  })
})
