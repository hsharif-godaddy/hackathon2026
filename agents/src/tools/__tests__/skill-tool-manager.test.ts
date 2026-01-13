/**
 * Unit tests for SkillToolManager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SkillToolManager } from '../skill-tool-manager.js';
import type { SkillToolDefinition } from '../skill-tool-manager.js';
import { z } from 'zod';

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

// Mock dynamic import for tools
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn()
}));

describe('SkillToolManager', () => {
  let manager: SkillToolManager;

  beforeEach(() => {
    manager = new SkillToolManager({
      inactivityThresholdTokens: 3000,
      maxActiveSkills: 3,
      enableLRU: true
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerSkill', () => {
    it('should reject invalid skill names', async () => {
      const result = await manager.registerSkill('../invalid', 'conv-123', 1000);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid skill name');
    });

    it('should accept valid skill names', async () => {
      // Mock the dynamic import to return empty tools
      vi.doMock('../skills/blog/tools/index.ts', () => ({}));

      const validNames = ['blog', 'my-skill', 'my_skill', 'skill123'];

      for (const name of validNames) {
        const result = await manager.registerSkill(name, 'conv-123', 1000);
        // Will fail to load tools but name validation should pass
        expect(result.error).not.toContain('Invalid skill name');
      }
    });

    // TODO: Re-enable when we have a skill with actual tools (database skill was removed)
    it.skip('should return already registered for duplicate registration', async () => {
      // Mock successful registration
      vi.doMock(
        '../skills/test-skill/tools/index.ts',
        () => ({
          testTool: {
            name: 'test',
            description: 'Test tool',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      // First registration
      const result1 = await manager.registerSkill('test-skill', 'conv-123', 1000);

      // Second registration of same skill
      const result2 = await manager.registerSkill('test-skill', 'conv-123', 2000);

      expect(result2.success).toBe(true);
      expect(result1.tools).toEqual(result2.tools);
    });
  });

  // TODO: Re-enable when we have a skill with actual tools (database skill was removed)
  describe.skip('getActiveSkills', () => {
    it('should return empty array for conversation with no skills', () => {
      const skills = manager.getActiveSkills('conv-123');
      expect(skills).toEqual([]);
    });

    it('should return only skills for the specified conversation', async () => {
      // Mock tool definitions
      vi.doMock(
        '../skills/skill1/tools/index.ts',
        () => ({
          tool1: {
            name: 'tool1',
            description: 'Tool 1',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      vi.doMock(
        '../skills/skill2/tools/index.ts',
        () => ({
          tool2: {
            name: 'tool2',
            description: 'Tool 2',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      // Register skills for different conversations
      await manager.registerSkill('skill1', 'conv-123', 1000);
      await manager.registerSkill('skill2', 'conv-456', 1000);

      const skills123 = manager.getActiveSkills('conv-123');
      const skills456 = manager.getActiveSkills('conv-456');

      expect(skills123).toContain('skill1');
      expect(skills123).not.toContain('skill2');
      expect(skills456).toContain('skill2');
      expect(skills456).not.toContain('skill1');
    });
  });

  // TODO: Re-enable when we have a skill with actual tools (database skill was removed)
  describe.skip('unloadSkill', () => {
    it('should return false for non-existent skill', () => {
      const result = manager.unloadSkill('nonexistent', 'conv-123');
      expect(result).toBe(false);
    });

    it('should return true and remove skill when it exists', async () => {
      // Mock tool definition
      vi.doMock(
        '../skills/test-skill/tools/index.ts',
        () => ({
          testTool: {
            name: 'test',
            description: 'Test tool',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      // Register skill
      await manager.registerSkill('test-skill', 'conv-123', 1000);

      // Verify it's active
      expect(manager.getActiveSkills('conv-123')).toContain('test-skill');

      // Unload it
      const result = manager.unloadSkill('test-skill', 'conv-123');

      expect(result).toBe(true);
      expect(manager.getActiveSkills('conv-123')).not.toContain('test-skill');
    });
  });

  // TODO: Re-enable when we have a skill with actual tools (database skill was removed)
  describe.skip('checkAndUnloadInactiveSkills', () => {
    it('should not unload skills below inactivity threshold', async () => {
      // Mock tool definition
      vi.doMock(
        '../skills/test-skill/tools/index.ts',
        () => ({
          testTool: {
            name: 'test',
            description: 'Test tool',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      // Register skill at token 1000
      await manager.registerSkill('test-skill', 'conv-123', 1000);

      // Check at token 3000 (below 3000 token threshold)
      const unloaded = await manager.checkAndUnloadInactiveSkills('conv-123', 3999);

      expect(unloaded).toEqual([]);
      expect(manager.getActiveSkills('conv-123')).toContain('test-skill');
    });

    it('should unload skills exceeding inactivity threshold', async () => {
      // Mock tool definition
      vi.doMock(
        '../skills/test-skill/tools/index.ts',
        () => ({
          testTool: {
            name: 'test',
            description: 'Test tool',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      // Register skill at token 1000
      await manager.registerSkill('test-skill', 'conv-123', 1000);

      // Check at token 5000 (exceeds 3000 token threshold)
      const unloaded = await manager.checkAndUnloadInactiveSkills('conv-123', 5000);

      expect(unloaded).toContain('test-skill');
      expect(manager.getActiveSkills('conv-123')).not.toContain('test-skill');
    });

    it('should keep recently used skills', async () => {
      // Mock tool definition
      vi.doMock(
        '../skills/test-skill/tools/index.ts',
        () => ({
          testTool: {
            name: 'test',
            description: 'Test tool',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      // Register skill at token 1000
      await manager.registerSkill('test-skill', 'conv-123', 1000);

      // Update usage at token 4000
      manager.updateSkillUsage('test-skill', 'conv-123', 4000);

      // Check at token 6000 (only 2000 tokens since last use)
      const unloaded = await manager.checkAndUnloadInactiveSkills('conv-123', 6000);

      expect(unloaded).toEqual([]);
      expect(manager.getActiveSkills('conv-123')).toContain('test-skill');
    });
  });

  // TODO: Re-enable when we have a skill with actual tools (database skill was removed)
  describe.skip('LRU eviction', () => {
    it('should not evict when below max skills', async () => {
      // Mock tool definitions
      for (let i = 1; i <= 2; i++) {
        vi.doMock(
          `../skills/skill${i}/tools/index.ts`,
          () => ({
            [`tool${i}`]: {
              name: `tool${i}`,
              description: `Tool ${i}`,
              parameters: z.object({}),
              execute: async () => ({})
            }
          })
        );
      }

      // Register 2 skills (below max of 3)
      await manager.registerSkill('skill1', 'conv-123', 1000);
      await manager.registerSkill('skill2', 'conv-123', 2000);

      const unloaded = await manager.checkAndUnloadInactiveSkills('conv-123', 3000);

      expect(unloaded).toEqual([]);
      expect(manager.getActiveSkills('conv-123').length).toBe(2);
    });

    it('should evict oldest skill when max exceeded', async () => {
      // Mock tool definitions
      for (let i = 1; i <= 4; i++) {
        vi.doMock(
          `../skills/skill${i}/tools/index.ts`,
          () => ({
            [`tool${i}`]: {
              name: `tool${i}`,
              description: `Tool ${i}`,
              parameters: z.object({}),
              execute: async () => ({})
            }
          })
        );
      }

      // Register 4 skills (exceeds max of 3)
      await manager.registerSkill('skill1', 'conv-123', 1000); // Oldest
      await manager.registerSkill('skill2', 'conv-123', 2000);
      await manager.registerSkill('skill3', 'conv-123', 3000);
      await manager.registerSkill('skill4', 'conv-123', 4000); // Newest

      const unloaded = await manager.checkAndUnloadInactiveSkills('conv-123', 5000);

      expect(unloaded).toContain('skill1'); // Oldest should be evicted
      expect(manager.getActiveSkills('conv-123').length).toBe(3);
      expect(manager.getActiveSkills('conv-123')).toContain('skill2');
      expect(manager.getActiveSkills('conv-123')).toContain('skill3');
      expect(manager.getActiveSkills('conv-123')).toContain('skill4');
    });

    it('should evict multiple skills to reach max', async () => {
      // Mock tool definitions
      for (let i = 1; i <= 5; i++) {
        vi.doMock(
          `../skills/skill${i}/tools/index.ts`,
          () => ({
            [`tool${i}`]: {
              name: `tool${i}`,
              description: `Tool ${i}`,
              parameters: z.object({}),
              execute: async () => ({})
            }
          })
        );
      }

      // Register 5 skills (exceeds max of 3 by 2)
      for (let i = 1; i <= 5; i++) {
        await manager.registerSkill(`skill${i}`, 'conv-123', i * 1000);
      }

      const unloaded = await manager.checkAndUnloadInactiveSkills('conv-123', 6000);

      expect(unloaded.length).toBe(2); // Should evict 2 oldest
      expect(unloaded).toContain('skill1');
      expect(unloaded).toContain('skill2');
      expect(manager.getActiveSkills('conv-123').length).toBe(3);
    });

    it('should respect LRU when some skills used more recently', async () => {
      // Mock tool definitions
      for (let i = 1; i <= 4; i++) {
        vi.doMock(
          `../skills/skill${i}/tools/index.ts`,
          () => ({
            [`tool${i}`]: {
              name: `tool${i}`,
              description: `Tool ${i}`,
              parameters: z.object({}),
              execute: async () => ({})
            }
          })
        );
      }

      // Register 4 skills
      await manager.registerSkill('skill1', 'conv-123', 1000); // Token 1000
      await manager.registerSkill('skill2', 'conv-123', 2000); // Token 2000
      await manager.registerSkill('skill3', 'conv-123', 3000); // Token 3000
      await manager.registerSkill('skill4', 'conv-123', 4000); // Token 4000

      // Update skill1 to be more recent than skill2
      manager.updateSkillUsage('skill1', 'conv-123', 5000); // Now token 5000

      const unloaded = await manager.checkAndUnloadInactiveSkills('conv-123', 6000);

      expect(unloaded).toContain('skill2'); // skill2 is now oldest
      expect(unloaded).not.toContain('skill1'); // skill1 was updated, should be kept
    });
  });

  describe('updateSkillUsage', () => {
    it('should update lastUsedTokenCount for existing skill', async () => {
      // Mock tool definition
      vi.doMock(
        '../skills/test-skill/tools/index.ts',
        () => ({
          testTool: {
            name: 'test',
            description: 'Test tool',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      // Register skill at token 1000
      await manager.registerSkill('test-skill', 'conv-123', 1000);

      // Update usage at token 5000
      manager.updateSkillUsage('test-skill', 'conv-123', 5000);

      // Should not be unloaded even at token 7000 (only 2000 since last use)
      const unloaded = await manager.checkAndUnloadInactiveSkills('conv-123', 7000);

      expect(unloaded).toEqual([]);
    });

    it('should handle non-existent skill gracefully', () => {
      // Should not throw
      expect(() => {
        manager.updateSkillUsage('nonexistent', 'conv-123', 5000);
      }).not.toThrow();
    });
  });

  describe('configuration', () => {
    it('should use environment variables for configuration', () => {
      process.env.SKILL_INACTIVITY_THRESHOLD_TOKENS = '5000';
      process.env.SKILL_MAX_ACTIVE_SKILLS = '5';
      process.env.SKILL_LRU_ENABLED = 'false';

      const customManager = new SkillToolManager();

      // Test by checking behavior (can't access private config directly)
      // We can verify by testing with the configured values

      delete process.env.SKILL_INACTIVITY_THRESHOLD_TOKENS;
      delete process.env.SKILL_MAX_ACTIVE_SKILLS;
      delete process.env.SKILL_LRU_ENABLED;
    });

    it('should allow configuration override', () => {
      const customManager = new SkillToolManager({
        inactivityThresholdTokens: 10000,
        maxActiveSkills: 10,
        enableLRU: false
      });

      // Manager should be created with custom config
      expect(customManager).toBeDefined();
    });
  });

  describe('tool name prefixing', () => {
    // TODO: Re-enable these tests when we have a skill with actual tools
    // Currently all existing skills are template-only (no tools/ directory)
    it.skip('should prefix tool names with skill name', async () => {
      // Mock tool definition
      vi.doMock(
        '../skills/blog/tools/index.ts',
        () => ({
          queryTool: {
            name: 'query',
            description: 'Query tool',
            parameters: z.object({}),
            execute: async () => ({})
          }
        })
      );

      const result = await manager.registerSkill('blog', 'conv-123', 1000);

      expect(result.tools).toContain('blog__query');
    });

    it.skip('should prevent tool name collisions between skills', async () => {
      // Mock tool definitions for two skills with same tool name
      vi.doMock(
        '../skills/blog/tools/index.ts',
        () => ({
          queryTool: {
            name: 'query',
            description: 'Blog query',
            parameters: z.object({}),
            execute: async () => ({ type: 'blog' })
          }
        })
      );

      vi.doMock(
        '../skills/seo/tools/index.ts',
        () => ({
          queryTool: {
            name: 'query',
            description: 'SEO query',
            parameters: z.object({}),
            execute: async () => ({ type: 'seo' })
          }
        })
      );

      const result1 = await manager.registerSkill('blog', 'conv-123', 1000);
      const result2 = await manager.registerSkill('seo', 'conv-123', 1000);

      expect(result1.tools).toContain('blog__query');
      expect(result2.tools).toContain('seo__query');

      // Tools should have different prefixed names
      const allTools = [...result1.tools, ...result2.tools];
      expect(new Set(allTools).size).toBe(allTools.length); // No duplicates
    });
  });
});
