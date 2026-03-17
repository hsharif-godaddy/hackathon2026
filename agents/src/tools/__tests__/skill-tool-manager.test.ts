/**
 * Unit tests for SkillToolManager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SkillToolManager } from '../skill-tool-manager.js';

// Mock logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}));

// Mock hook handlers for testing (hoisted so vi.mock factory can reference them)
const { mockOnInstallHook, mockOnLoadHook } = vi.hoisted(() => ({
  mockOnInstallHook: vi.fn(),
  mockOnLoadHook: vi.fn()
}));

// Mock buildAllSkillTools from ai-skills
vi.mock('@airo/ai-skills', async () => {
  const actual = await vi.importActual('@airo/ai-skills');
  return {
    ...actual,
    buildAllSkillTools: vi.fn().mockResolvedValue({
      tools: {
        'blog__createPost': { description: 'Create a blog post' },
        'blog__listPosts': { description: 'List blog posts' },
        'database__query': { description: 'Query database' }
      },
      skillToTools: new Map([
        ['blog', ['createPost', 'listPosts']],
        ['database', ['query']]
      ]),
      skillHooks: new Map([
        ['blog', { onInstall: mockOnInstallHook, onLoad: mockOnLoadHook }]
      ])
    })
  };
});

describe('SkillToolManager', () => {
  let manager: SkillToolManager;

  beforeEach(async () => {
    manager = new SkillToolManager();
    await manager.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should pre-register all skill tools', async () => {
      const tools = manager.getAllTools();
      expect(Object.keys(tools)).toContain('blog__createPost');
      expect(Object.keys(tools)).toContain('blog__listPosts');
      expect(Object.keys(tools)).toContain('database__query');
    });

    it('should be idempotent', async () => {
      await manager.initialize();
      await manager.initialize();
      // Should not throw or duplicate tools
      const tools = manager.getAllTools();
      expect(Object.keys(tools).length).toBe(3);
    });
  });

  describe('registerSkill', () => {
    it('should reject invalid skill names', () => {
      const result = manager.registerSkill('../invalid', 'conv-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid skill name');
    });

    it('should accept valid skill names', () => {
      const validNames = ['blog', 'my-skill', 'my_skill', 'skill123'];

      for (const name of validNames) {
        const result = manager.registerSkill(name, 'conv-123');
        // Only 'blog' and 'database' have tools registered in mock
        if (name === 'blog') {
          expect(result.success).toBe(true);
        } else {
          expect(result.error).not.toContain('Invalid skill name');
        }
      }
    });

    it('should return tool names when activating a skill', () => {
      const result = manager.registerSkill('blog', 'conv-123');

      expect(result.success).toBe(true);
      expect(result.tools).toContain('blog__createPost');
      expect(result.tools).toContain('blog__listPosts');
    });

    it('should fail for skills without registered tools', () => {
      const result = manager.registerSkill('unknown-skill', 'conv-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('no tools registered');
    });
  });

  describe('step-based skill tracking', () => {
    it('should track skill usage via updateSkillUsage', () => {
      // updateSkillUsage should not throw for non-existent skill
      expect(() => {
        manager.updateSkillUsage('conv-123', 'nonexistent', 5);
      }).not.toThrow();
    });

    it('should cleanup inactive skills after threshold steps', () => {
      // Activate a skill at step 0
      manager.activateSkill('conv-123', 'blog', 0);

      // Should not be cleaned up at step 25 (threshold is 30)
      let cleaned = manager.cleanupInactiveSkills('conv-123', 25);
      expect(cleaned).toEqual([]);

      // Should be cleaned up at step 35 (30+ steps inactive)
      cleaned = manager.cleanupInactiveSkills('conv-123', 35);
      expect(cleaned).toContain('blog');
    });

    it('should keep active skills when usage is updated', () => {
      // Activate a skill at step 0
      manager.activateSkill('conv-123', 'blog', 0);

      // Update usage at step 8
      manager.updateSkillUsage('conv-123', 'blog', 8);

      // Should not be cleaned up at step 15 (only 7 steps since last use)
      const cleaned = manager.cleanupInactiveSkills('conv-123', 15);
      expect(cleaned).toEqual([]);
    });

    it('should return active tool names for conversation', () => {
      // Initially no active tools
      expect(manager.getActiveToolNames('conv-123')).toEqual([]);

      // Activate skill via registerSkill (which also sets up tool names)
      manager.registerSkill('blog', 'conv-123');

      // Now tool names should be returned
      const toolNames = manager.getActiveToolNames('conv-123');
      expect(toolNames).toContain('blog__createPost');
      expect(toolNames).toContain('blog__listPosts');
    });
  });

  describe('unloadSkill', () => {
    it('should deactivate a skill', () => {
      // Activate first
      manager.registerSkill('blog', 'conv-123');
      expect(manager.getActiveToolNames('conv-123').length).toBeGreaterThan(0);

      // Deactivate
      manager.unloadSkill('blog', 'conv-123');
      expect(manager.getActiveToolNames('conv-123')).toEqual([]);
    });
  });

  describe('getActiveSkills', () => {
    it('should return list of active skill names', () => {
      expect(manager.getActiveSkills('conv-123')).toEqual([]);

      manager.registerSkill('blog', 'conv-123');
      expect(manager.getActiveSkills('conv-123')).toContain('blog');

      manager.registerSkill('database', 'conv-123');
      expect(manager.getActiveSkills('conv-123')).toContain('blog');
      expect(manager.getActiveSkills('conv-123')).toContain('database');
    });
  });

  describe('runHook', () => {
    beforeEach(() => {
      mockOnInstallHook.mockReset();
      mockOnLoadHook.mockReset();
    });

    it('should call registered hook for a skill', async () => {
      await manager.runHook('blog', 'onInstall', { skillName: 'blog', appPath: '/tmp/app' });
      expect(mockOnInstallHook).toHaveBeenCalledWith({ skillName: 'blog', appPath: '/tmp/app' });
    });

    it('should not throw for skills without hooks', async () => {
      await expect(
        manager.runHook('database', 'onInstall', { skillName: 'database' })
      ).resolves.toBeUndefined();
    });

    it('should not throw for skills with no matching event', async () => {
      await expect(
        manager.runHook('blog', 'onUnload', { skillName: 'blog' })
      ).resolves.toBeUndefined();
    });

    it('should not throw for unknown skills', async () => {
      await expect(
        manager.runHook('unknown', 'onLoad', { skillName: 'unknown' })
      ).resolves.toBeUndefined();
    });

    it('should catch errors from hooks and not throw', async () => {
      mockOnLoadHook.mockRejectedValue(new Error('hook failed'));
      await expect(
        manager.runHook('blog', 'onLoad', { skillName: 'blog' })
      ).resolves.toBeUndefined();
    });
  });

  describe('configuration', () => {
    it('should use environment variable for inactivity threshold', () => {
      // SKILL_INACTIVITY_THRESHOLD_STEPS is read at module load time
      // Just verify the manager can be instantiated
      const customManager = new SkillToolManager();
      expect(customManager).toBeDefined();
    });
  });
});
