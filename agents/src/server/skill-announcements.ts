import type { SkillAnnouncement, SkillSessionAnnouncements } from '@airo/ai-skills';

/**
 * Pure helpers for the session-start announcement bootstrap. Kept free of DB,
 * filesystem, and skill-manager imports so the gating logic is trivially testable.
 * The orchestration (hook iteration, memory marker I/O) lives in
 * `skill-announcements-context.ts`.
 */

/**
 * Shape of an announcement context message.
 *
 * IMPORTANT: `role` is `'user'`, never `'system'`. Anthropic requires every
 * system message to sit in ONE contiguous block at the very start of the prompt.
 * On long sessions the before-history bucket already contains a `role: 'user'`
 * conversation-summary message (see `context-manager.ts` — memory summary). A
 * `role: 'system'` announcement appended after it becomes a SECOND system block
 * separated by that user message, which `@ai-sdk/anthropic` rejects with
 * "Multiple system messages ... separated by user/assistant messages". Injecting
 * as `'user'` keeps the system block contiguous and, per the same SECURITY rule
 * applied to memory/app-context, avoids elevating skill-derived content to
 * system-prompt privilege. The literal type makes a regression a compile error.
 */
export interface SkillAnnouncementContextMessage {
  role: 'user';
  content: string;
  insertionOrder: 'before_history';
}

/**
 * Per-app, per-skill announcement bookmark.
 *
 * `seenVersion` is the catalog version the customer has been caught up to.
 * `openIds` are capabilities we have already announced that the customer has NOT
 * adopted yet — they stay "open" and keep resurfacing as "pick up where you left
 * off" until built (then they fall out of the skill's pending set automatically).
 *
 * This replaces the old bare `lastSeenVersion` integer: a watermark alone buried
 * any announced-but-unbuilt capability the moment the marker advanced, so a
 * returning customer who ignored a nudge never saw it again. Tracking the open set
 * keeps unfinished work visible while still announcing each NEW capability once.
 */
export interface SkillAnnounceState {
  seenVersion: number;
  openIds: string[];
}

/** Why a capability is being surfaced — drives how it is grouped in the note. */
export type AnnouncementReason = 'new' | 'resumed';

export interface SelectedAnnouncement extends SkillAnnouncement {
  reason: AnnouncementReason;
}

/** Empty bookmark for a never-seen app. */
export function emptyAnnounceState(): SkillAnnounceState {
  return { seenVersion: 0, openIds: [] };
}

/**
 * Decide which announcements to surface this session and the bookmark to persist.
 *
 * The hook reports the skill's CURRENTLY pending (not-yet-built) capabilities,
 * each tagged with the catalog version it shipped in. Against the stored bookmark:
 *
 *   • `new`     — pending && version > seenVersion  (a capability the customer has
 *                 never been told about). Announced once, then it becomes "open".
 *   • `resumed` — pending && already in `openIds`    (announced before, still not
 *                 built). Keeps resurfacing until the customer builds it.
 *
 * `nextState.openIds` = the pending ids the customer has been told about (prior
 * open set ∪ this session's new items), intersected with what is STILL pending.
 * Built capabilities drop out of the skill's pending set, so they leave `openIds`
 * automatically. Crucially, EVERY new item enters `openIds` even if the display
 * cap hid it — otherwise, once `seenVersion` advances past it, it would be neither
 * "new" nor "open" and would vanish forever (the bug this fixes).
 *
 * `nextState.seenVersion` advances to the skill's current catalog version ("caught
 * up to current"), consistent with the in-skill `suggest_next` path.
 */
export function selectAnnouncements(
  result: SkillSessionAnnouncements | null,
  state: SkillAnnounceState,
  maxItems = 3,
): { items: SelectedAnnouncement[]; nextState: SkillAnnounceState } {
  if (!result) {
    return { items: [], nextState: state };
  }

  const pending = result.announcements;
  const openSet = new Set(state.openIds);

  const newItems = pending.filter((a) => a.version > state.seenVersion);
  const newIds = new Set(newItems.map((a) => a.id));
  const resumedItems = pending.filter(
    (a) => a.version <= state.seenVersion && openSet.has(a.id),
  );

  const items: SelectedAnnouncement[] = [
    ...newItems.map((a) => ({ ...a, reason: 'new' as const })),
    ...resumedItems.map((a) => ({ ...a, reason: 'resumed' as const })),
  ].slice(0, maxItems);

  // Everything we've told them that is still pending stays open. Built items are
  // no longer pending, so they are excluded here. All new items are retained even
  // if the display cap hid them, so they resume next session instead of vanishing.
  const nextOpenIds = pending
    .map((a) => a.id)
    .filter((id) => openSet.has(id) || newIds.has(id));

  return {
    items,
    nextState: { seenVersion: result.currentVersion, openIds: nextOpenIds },
  };
}

/** Render the context-message body shown when capabilities are available. */
export function renderAnnouncementMessage(items: SelectedAnnouncement[]): string {
  const newItems = items.filter((i) => i.reason === 'new');
  const resumedItems = items.filter((i) => i.reason === 'resumed');
  const bullet = (i: SelectedAnnouncement): string => `- **${i.label}** — ${i.summary}`;

  const sections: string[] = [];
  if (newItems.length > 0) {
    sections.push(
      `✨ New since your last visit:\n${newItems.map(bullet).join('\n')}`,
    );
  }
  if (resumedItems.length > 0) {
    sections.push(
      `↩️ Pick up where you left off (available, not set up yet):\n` +
        `${resumedItems.map(bullet).join('\n')}`,
    );
  }

  return (
    `# What's new for this site\n\n` +
    `The customer is returning. These capabilities are available and are NOT yet ` +
    `set up on their site:\n\n` +
    `${sections.join('\n\n')}\n\n` +
    `If it fits the conversation, briefly mention these in plain English and offer ` +
    `them via the suggestedResponse tool (clickable options). Describe each capability ` +
    `plainly — never mention internal tool or skill names. Skip anything the customer has ` +
    `already declined. If it does not fit naturally, stay silent and handle their actual request.`
  );
}

/**
 * Build the announcement context message for a set of selected capabilities.
 *
 * Always `role: 'user'` + `before_history` — see `SkillAnnouncementContextMessage`
 * for why the role must not be `'system'`.
 */
export function buildAnnouncementContextMessage(
  items: SelectedAnnouncement[],
): SkillAnnouncementContextMessage {
  return {
    role: 'user',
    content: renderAnnouncementMessage(items),
    insertionOrder: 'before_history',
  };
}