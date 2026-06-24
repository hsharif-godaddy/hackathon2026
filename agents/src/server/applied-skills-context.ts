/**
 * Builds a structured XML context message describing which skills are installed
 * in this app and what their current configuration looks like.
 *
 * ─── installed_at ─────────────────────────────────────────────────────────────
 *   When the skill's template files were first scaffolded into the app.
 *   Source: <appPath>/.airo/applied-skills.json
 *
 * ─── current_state ────────────────────────────────────────────────────────────
 *   Lightweight context the skill considers important enough to survive
 *   conversation summarization. Its purpose is to give the LLM the facts it
 *   needs to reason deterministically on re-entry — what was done, what was
 *   chosen, which step was reached, which IDs are in play — without relying on
 *   summarized history. This is a mutable snapshot, not a log: skill tools
 *   overwrite it when something changes (e.g. switching OAuth providers), so
 *   the LLM always sees current reality, not stale history.
 *   Source: <appPath>/.airo/skills/<skillName>/state.json
 */

import { appRepository } from '../database/repositories/index.js';
import { logger } from '../logging/index.js';
import { appliedSkillsRegistry } from '../tools/applied-skills-registry.js';
import type { AppliedSkillsContextMessage } from './pinned-skills-context.js';

/**
 * Return a single context message listing all installed skills and their
 * current state, or null when nothing has been recorded yet.
 */
export async function buildAppliedSkillsContextMessage(
  appId?: string
): Promise<AppliedSkillsContextMessage | null> {
  if (!appId) return null;

  try {
    const appPath = appRepository.findById(appId)?.path;
    if (!appPath) return null;

    await appliedSkillsRegistry.hydrateFromAppPath(appPath);

    const installedSkills = appliedSkillsRegistry.getInstalledSkills(appPath);
    if (installedSkills.size === 0) return null;

    const skillElements: string[] = [];

    for (const [name, entry] of installedSkills) {
      try {
        const attrs: string[] = [`name="${name}"`];
        if (entry.installedAt) attrs.push(`installed_at="${entry.installedAt}"`);
        if (entry.completedAt) attrs.push(`completed_at="${entry.completedAt}"`);

        const currentState = await appliedSkillsRegistry.readSkillState(name, appPath);
        const body = currentState
          ? `\n    <current_state>\n${JSON.stringify(currentState, null, 2).replace(/^/gm, '      ')}\n    </current_state>\n  `
          : '';

        skillElements.push(`  <skill ${attrs.join(' ')}>${body}</skill>`);
      } catch (error) {
        // Defensive: a thrown error here would propagate to the outer context-provider
        // catch and zero out ALL context messages for the turn — not just applied-skills.
        // Skipping the offending skill preserves the context bundle for all others.
        logger.warn('applied_skills.context.skill_failed', {
          appId,
          skill: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (skillElements.length === 0) return null;

    const content = [
      '## Applied Skills — Already Built in This App',
      '',
      'The following skills have been applied to this app. This record is durable and survives conversation summarization.',
      '',
      '**Rules:**',
      '- Every skill listed here **was applied to this app**. Do NOT re-scaffold it from scratch or announce it as a new feature.',
      '- `<current_state>` records key facts the skill preserved across summarization — trust it over conversation history when reasoning about what is already in place.',
      '- No `<current_state>` means the skill either has nothing to track, or setup was not yet finished. Do not assume either direction — wait for the user to ask you to continue.',
      '- Load a skill only if the user asks to extend it and its instructions are not already in your context.',
      '',
      '<applied_skills>',
      ...skillElements,
      '</applied_skills>',
    ].join('\n');

    return {
      role: 'user',
      content,
      insertionOrder: 'after_history',
    };
  } catch (error) {
    logger.error('applied_skills.context.build_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
