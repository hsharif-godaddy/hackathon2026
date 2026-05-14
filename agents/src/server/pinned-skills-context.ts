import { SkillLoaderTool } from '../tools/skill-loader-tool.js';
import { skillToolManager } from '../tools/skill-tool-manager.js';
import { logger } from '../logging/index.js';

/**
 * Shape used for per-turn pinned-skill context messages. Matches ai-transport's ContextMessage.
 *
 * `insertionOrder` is locked to `'before_history'`: Anthropic's API rejects
 * multiple system messages interleaved with user/assistant history ("Multiple
 * system messages that are separated by user/assistant messages"). Placing
 * pinned content before the conversation history keeps every system message in
 * the leading cluster, which is allowed.
 */
export interface PinnedContextMessage {
  role: 'system';
  content: string;
  insertionOrder: 'before_history';
}

/**
 * Build one context message per pinned skill for the given conversation.
 * Each message labels the content as pinned mode context so the model
 * reads it as always-on instruction rather than one of many loadable skills.
 *
 * Skills that fail to load (missing skill.md, invalid name) are dropped
 * with a warn log — a broken pin should not break the conversation.
 */
export async function buildPinnedSkillsContextMessages(
  conversationId: string,
  appPath?: string
): Promise<PinnedContextMessage[]> {
  // Lazy hydrate from `<appPath>/.airo/pinned-skills.json` before reading
  // pins. The first context-load per appPath after process start pays the
  // disk read; subsequent calls short-circuit. PaaS conversations without
  // a known app path skip persistence — pins still work in-memory.
  if (appPath) {
    await skillToolManager.hydrateFromAppPath(appPath);
  }
  const names = skillToolManager.getPinnedSkills(conversationId);
  if (names.length === 0) return [];

  const loader = new SkillLoaderTool();
  const messages: PinnedContextMessage[] = [];

  for (const name of names) {
    let result: Awaited<ReturnType<typeof loader.loadSkill>>;
    try {
      result = await loader.loadSkill({ skill: name });
    } catch (error) {
      // Defensive: a thrown error here would propagate up to the outer
      // context-provider catch and zero out ALL context messages for the
      // turn (not just pinned). Catching keeps the contract that a broken
      // pin does not break the conversation.
      logger.warn('skill.pinned.load_failed', {
        conversationId,
        skill: name,
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (!result.success || !result.instructions) {
      logger.warn('skill.pinned.load_failed', {
        conversationId,
        skill: name,
        error: result.error
      });
      continue;
    }
    messages.push({
      role: 'system',
      content:
        `# Pinned skill: ${name}\n\n` +
        `The following instructions are pinned for this conversation. ` +
        `Treat them as always-on mode context — they apply to every turn ` +
        `until the skill is unpinned.\n\n` +
        result.instructions,
      insertionOrder: 'before_history'
    });
  }

  return messages;
}
