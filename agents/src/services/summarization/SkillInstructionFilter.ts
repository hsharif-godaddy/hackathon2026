/**
 * Skill Instruction Filter
 *
 * Filters inactive skill instructions from conversation messages during summarization.
 * This prevents context bloat from skills that have been unloaded.
 *
 * How it works:
 * 1. Identifies skill tool results in messages (toolName === 'skill')
 * 2. Extracts the skill name from the tool output
 * 3. Checks if skill is still active via skillToolManager
 * 4. Replaces inactive skill instructions with a small stub
 *
 * Context savings: ~7KB → ~100 bytes per inactive skill
 */

import type { LLMMessage, ToolResultPart } from '../ConversationHistoryLoader.js';
import { isAIToolMessage } from '../ConversationHistoryLoader.js';
import { skillToolManager } from '../../tools/skill-tool-manager.js';
import { logger } from '../../logging/index.js';

/**
 * Check if a tool result is from the skill tool
 */
function isSkillToolResult(toolResult: ToolResultPart): boolean {
  return toolResult.toolName === 'skill';
}

/**
 * Extract skill name from skill tool result
 * The tool result output contains { skill: 'skillName', instructions: '...' }
 */
function extractSkillNameFromResult(toolResult: ToolResultPart): string | null {
  try {
    // The output could be in different formats
    if (typeof toolResult.output === 'object' && toolResult.output !== null) {
      // Check for direct object format: { skill: 'name', instructions: '...' }
      if ('skill' in toolResult.output) {
        return String(toolResult.output.skill);
      }

      // Check for text format: { type: 'text', value: '...' }
      if ('type' in toolResult.output && toolResult.output.type === 'text' && 'value' in toolResult.output) {
        const value = toolResult.output.value as string;
        // Try to parse as JSON
        try {
          const parsed = JSON.parse(value);
          return parsed.skill || null;
        } catch {
          // Not JSON, might be plain text
          return null;
        }
      }
    }
  } catch (error) {
    logger.warn('skill.extract_name.failure', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return null;
}

/**
 * Filter inactive skill instructions from messages before summarization
 *
 * Replaces full skill instructions (typically 5-15KB) with a small stub message (~100 bytes)
 * for skills that are no longer active in the conversation.
 *
 * @param messages - Conversation messages to filter
 * @param conversationId - ID of the conversation
 * @returns Filtered messages with inactive skill instructions replaced
 */
export function filterInactiveSkillInstructions(
  messages: LLMMessage[],
  conversationId: string
): LLMMessage[] {
  const activeSkills = skillToolManager.getActiveSkills(conversationId);

  logger.debug('summarization.skill_filter.begin', {
    conversationId,
    messageCount: messages.length,
    activeSkills
  });

  let filteredCount = 0;

  const filtered = messages.map(msg => {
    // Only process AI SDK v6 tool messages
    if (!isAIToolMessage(msg)) {
      return msg;
    }

    // Check each tool result in the message
    const newContent = msg.content.map(toolResult => {
      // Is this a skill tool result?
      if (!isSkillToolResult(toolResult)) {
        return toolResult;
      }

      // Extract the skill name
      const skillName = extractSkillNameFromResult(toolResult);
      if (!skillName) {
        return toolResult; // Can't determine skill name, keep as-is
      }

      // Is this skill still active?
      if (activeSkills.includes(skillName)) {
        return toolResult; // Keep active skill instructions
      }

      // Skill is inactive - replace instructions with stub
      filteredCount++;

      logger.debug('summarization.skill_filter.removed', {
        conversationId,
        skillName,
        toolCallId: toolResult.toolCallId
      });

      // Replace the entire output with a small stub
      return {
        ...toolResult,
        output: {
          type: 'text' as const,
          value: JSON.stringify({
            skill: skillName,
            message: `Skill '${skillName}' was loaded and later unloaded. Instructions removed to save context.`,
            wasActive: false
          })
        }
      };
    });

    return {
      ...msg,
      content: newContent
    };
  });

  if (filteredCount > 0) {
    logger.info('summarization.skill_filter.complete', {
      conversationId,
      filteredCount,
      activeSkills
    });
  }

  return filtered;
}
