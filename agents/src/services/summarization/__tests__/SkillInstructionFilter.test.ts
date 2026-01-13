import { describe, it, expect, beforeEach, vi } from 'vitest';
import { filterInactiveSkillInstructions } from '../SkillInstructionFilter.js';
import type { LLMMessage, AIToolMessage } from '../../ConversationHistoryLoader.js';
import { skillToolManager } from '../../../tools/skill-tool-manager.js';

// Mock the skillToolManager
vi.mock('../../../tools/skill-tool-manager.js', () => ({
  skillToolManager: {
    getActiveSkills: vi.fn()
  }
}));

describe('SkillInstructionFilter', () => {
  const conversationId = 'test-conv-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('filterInactiveSkillInstructions', () => {
    it('should keep non-tool messages unchanged', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'system', content: 'System message' }
      ];

      vi.mocked(skillToolManager.getActiveSkills).mockReturnValue([]);

      const result = filterInactiveSkillInstructions(messages, conversationId);

      expect(result).toEqual(messages);
      expect(result).toHaveLength(3);
    });

    it('should keep non-skill tool messages unchanged', () => {
      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'readFile',
            output: { type: 'text', value: 'File content' }
          }]
        }
      ];

      vi.mocked(skillToolManager.getActiveSkills).mockReturnValue([]);

      const result = filterInactiveSkillInstructions(messages, conversationId);

      expect(result).toEqual(messages);
    });

    it('should keep active skill instructions unchanged', () => {
      const skillInstructions = '# Blog Skill\n\nThis is a long skill description...';

      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'skill',
            output: {
              skill: 'blog',
              instructions: skillInstructions,
              toolsAvailable: ['blog__tool1'],
              message: 'Skill loaded'
            }
          }]
        }
      ];

      // Mark blog skill as active
      vi.mocked(skillToolManager.getActiveSkills).mockReturnValue(['blog']);

      const result = filterInactiveSkillInstructions(messages, conversationId);

      // Should be unchanged since skill is active
      expect(result).toEqual(messages);
      expect(result[0]).toHaveProperty('role', 'tool');
      const toolMsg = result[0] as AIToolMessage;
      expect(toolMsg.content[0].output).toHaveProperty('instructions', skillInstructions);
    });

    it('should replace inactive skill instructions with stub', () => {
      const skillInstructions = '# Blog Skill\n\nThis is a long skill description with 7KB of content...';

      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'skill',
            output: {
              skill: 'blog',
              instructions: skillInstructions,
              toolsAvailable: ['blog__tool1'],
              message: 'Skill loaded'
            }
          }]
        }
      ];

      // Mark blog skill as INACTIVE (not in active list)
      vi.mocked(skillToolManager.getActiveSkills).mockReturnValue([]);

      const result = filterInactiveSkillInstructions(messages, conversationId);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('role', 'tool');

      const toolMsg = result[0] as AIToolMessage;
      expect(toolMsg.content[0].toolName).toBe('skill');

      // Output should be replaced with stub
      const output = toolMsg.content[0].output as { type: string; value: string };
      expect(output.type).toBe('text');

      const parsed = JSON.parse(output.value);
      expect(parsed.skill).toBe('blog');
      expect(parsed.message).toContain('unloaded');
      expect(parsed.wasActive).toBe(false);

      // Original instructions should be gone
      expect(output.value).not.toContain(skillInstructions);
      expect(output.value.length).toBeLessThan(200); // Stub is small
    });

    it('should handle multiple skills in one conversation', () => {
      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'skill',
            output: {
              skill: 'blog',
              instructions: '# Blog Skill\n...',
              toolsAvailable: []
            }
          }]
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'skill',
            output: {
              skill: 'seo',
              instructions: '# SEO Skill\n...',
              toolsAvailable: []
            }
          }]
        }
      ];

      // Only blog is active, seo is inactive
      vi.mocked(skillToolManager.getActiveSkills).mockReturnValue(['blog']);

      const result = filterInactiveSkillInstructions(messages, conversationId);

      expect(result).toHaveLength(2);

      // First message (blog) should be unchanged
      const blogMsg = result[0] as AIToolMessage;
      const blogOutput = blogMsg.content[0].output as any;
      expect(blogOutput.skill).toBe('blog');
      expect(blogOutput.instructions).toContain('Blog Skill');

      // Second message (seo) should be stubbed
      const seoMsg = result[1] as AIToolMessage;
      const seoOutput = seoMsg.content[0].output as { type: string; value: string };
      expect(seoOutput.type).toBe('text');
      const parsed = JSON.parse(seoOutput.value);
      expect(parsed.skill).toBe('seo');
      expect(parsed.wasActive).toBe(false);
    });

    it('should handle mixed tool results in same message', () => {
      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'readFile',
              output: { type: 'text', value: 'File content' }
            },
            {
              type: 'tool-result',
              toolCallId: 'call-2',
              toolName: 'skill',
              output: {
                skill: 'blog',
                instructions: '# Blog...',
                toolsAvailable: []
              }
            }
          ]
        }
      ];

      // Blog is inactive
      vi.mocked(skillToolManager.getActiveSkills).mockReturnValue([]);

      const result = filterInactiveSkillInstructions(messages, conversationId);

      const toolMsg = result[0] as AIToolMessage;
      expect(toolMsg.content).toHaveLength(2);

      // First tool result (readFile) unchanged
      expect(toolMsg.content[0].toolName).toBe('readFile');
      expect(toolMsg.content[0].output).toEqual({ type: 'text', value: 'File content' });

      // Second tool result (skill) should be stubbed
      expect(toolMsg.content[1].toolName).toBe('skill');
      const output = toolMsg.content[1].output as { type: string; value: string };
      expect(output.type).toBe('text');
      const parsed = JSON.parse(output.value);
      expect(parsed.wasActive).toBe(false);
    });

    it('should handle skill output in JSON string format', () => {
      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'skill',
            output: {
              type: 'text',
              value: JSON.stringify({
                skill: 'blog',
                instructions: '# Blog Skill\n...',
                toolsAvailable: []
              })
            }
          }]
        }
      ];

      // Blog is inactive
      vi.mocked(skillToolManager.getActiveSkills).mockReturnValue([]);

      const result = filterInactiveSkillInstructions(messages, conversationId);

      const toolMsg = result[0] as AIToolMessage;
      const output = toolMsg.content[0].output as { type: string; value: string };

      const parsed = JSON.parse(output.value);
      expect(parsed.skill).toBe('blog');
      expect(parsed.wasActive).toBe(false);
    });

    it('should gracefully handle malformed skill output', () => {
      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'skill',
            output: {
              // Missing 'skill' field
              instructions: 'Some instructions',
              toolsAvailable: []
            }
          }]
        }
      ];

      vi.mocked(skillToolManager.getActiveSkills).mockReturnValue([]);

      // Should not throw, just keep message as-is
      expect(() => {
        filterInactiveSkillInstructions(messages, conversationId);
      }).not.toThrow();
    });
  });
});
