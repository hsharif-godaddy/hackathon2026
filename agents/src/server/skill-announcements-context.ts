import { skillToolManager } from '../tools/skill-tool-manager.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { getKvMemoryStore } from '../memory/adapters/index.js';
import type { KvMemoryStore } from '../memory/interfaces/kv-memory-store.js';
import { workspaceScopeFromAppId, type WorkspaceScope } from '../memory/interfaces/scope.js';
import { logger } from '../logging/index.js';
import {
  buildAnnouncementContextMessage,
  emptyAnnounceState,
  selectAnnouncements,
  type SkillAnnounceState,
  type SkillAnnouncementContextMessage,
} from './skill-announcements.js';

/**
 * Generic session-start bootstrap that surfaces "what's new" announcements from
 * any installed skill — proactively, before the customer mentions the feature.
 *
 * This is the orchestration half of the Open/Closed seam: it iterates EVERY skill
 * that exposes an `onSessionStart` hook and asks it for relevant, not-yet-adopted
 * capabilities. Each skill self-detects its own footprint in the app, so nothing
 * here is keyed by skill name (see Self-Containment Rule, skills/README.md). To add
 * a new "what's new" provider, a skill implements `onSessionStart` — no edits here.
 *
 * Per-skill dedup is generic: a customer's announcement bookmark is stored under
 * memory key `<skillName>.announceState` (e.g. `online-appointments.announceState`)
 * as `{ seenVersion, openIds }`. NEW capabilities (version > seenVersion) are shown
 * once; capabilities already announced but still not built stay in `openIds` and keep
 * resurfacing as "pick up where you left off" until they are built. See
 * `selectAnnouncements`. The legacy bare-integer `<skillName>.lastSeenVersion` marker
 * is migrated on read.
 *
 * Side-effect note: this advances the bookmark at context-build time, so an
 * announcement counts as "seen" once it is injected — accepted as a low-stakes UX
 * tradeoff (worst case a returning customer misses one new-feature nudge on a turn
 * that errored before the model responded). The function never throws; a failure in
 * one skill is logged and skipped so it can never break context assembly.
 */

const ANNOUNCE_STATE_SUFFIX = '.announceState';
/** Legacy bare-integer marker, migrated into {@link SkillAnnounceState} on read. */
const LEGACY_LAST_SEEN_SUFFIX = '.lastSeenVersion';

const appRepository = new AppRepository();

/** Narrow an unknown KV value into a {@link SkillAnnounceState}. */
function isAnnounceState(value: unknown): value is SkillAnnounceState {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SkillAnnounceState).seenVersion === 'number' &&
    Array.isArray((value as SkillAnnounceState).openIds)
  );
}

/**
 * Read the per-skill bookmark, migrating the legacy bare-integer
 * `<skillName>.lastSeenVersion` marker into a {@link SkillAnnounceState} when the
 * new `<skillName>.announceState` key is absent (so previously-caught-up customers
 * keep their watermark and only see genuinely newer capabilities).
 */
async function readAnnounceState(
  kv: KvMemoryStore,
  scope: WorkspaceScope,
  skillName: string,
  stateKey: string,
): Promise<SkillAnnounceState> {
  const read = await kv.get(scope, stateKey);
  if (read.exists && isAnnounceState(read.value)) {
    return read.value;
  }

  const legacy = await kv.get(scope, `${skillName}${LEGACY_LAST_SEEN_SUFFIX}`);
  if (legacy.exists && typeof legacy.value === 'number') {
    // One-time migration of the bare-integer watermark to the {seenVersion, openIds}
    // bookmark — log it so the version history of a returning customer is traceable.
    logger.info('skill.announcements.legacy_migrated', {
      appId: scope.appId,
      skillName,
      seenVersion: legacy.value,
    });
    return { seenVersion: legacy.value, openIds: [] };
  }

  return emptyAnnounceState();
}

/**
 * True when the advanced bookmark differs from what is stored. Compares
 * `seenVersion` and `openIds` as a set (order-independent), so the caller can
 * persist the bookmark only when it actually changed.
 */
function announceStateChanged(prev: SkillAnnounceState, next: SkillAnnounceState): boolean {
  if (prev.seenVersion !== next.seenVersion) return true;
  if (prev.openIds.length !== next.openIds.length) return true;
  const prevSet = new Set(prev.openIds);
  return next.openIds.some((id) => !prevSet.has(id));
}

/**
 * Build one context message per skill that has new, not-yet-adopted capabilities
 * for the given app. Messages are `role: 'user'` + `before_history` so they bucket
 * just after the leading system cluster without breaking its contiguity — see
 * `SkillAnnouncementContextMessage` for why the role must not be `'system'`.
 */
export async function buildSkillAnnouncementContextMessages(
  appId?: string,
  skillSuggestionsEnabled = false,
): Promise<SkillAnnouncementContextMessage[]> {
  // Gated by the `appbuilder-skill-suggestions` Switchboard flag (delivered on the
  // agent JWT as `skillSuggestionsEnabled`). When off, the whole pending-skills
  // feature — including these proactive session-start announcements — is silent.
  if (!skillSuggestionsEnabled) return [];
  if (!appId) return [];

  const skillNames = skillToolManager.listSkillsWithSessionStart();
  if (skillNames.length === 0) return [];

  const app = appRepository.findById(appId);
  if (!app) return [];

  const kv = getKvMemoryStore();
  const scope = workspaceScopeFromAppId(appId);
  const messages: SkillAnnouncementContextMessage[] = [];

  for (const skillName of skillNames) {
    try {
      const result = await skillToolManager.runSessionStartHook(skillName, {
        skillName,
        appId,
        appPath: app.path,
      });
      if (!result) continue;

      const stateKey = `${skillName}${ANNOUNCE_STATE_SUFFIX}`;
      const state = await readAnnounceState(kv, scope, skillName, stateKey);

      // Versioning snapshot: the bookmark we diff the skill's report against.
      // seenVersion = catalog version the customer is caught up to; openIds =
      // already-announced-but-not-yet-built capabilities; result.currentVersion =
      // the skill's latest catalog version; result.announcements = currently pending.
      logger.info('skill.announcements.evaluating', {
        appId,
        skillName,
        seenVersion: state.seenVersion,
        currentVersion: result.currentVersion,
        reportedPendingCount: result.announcements.length,
        openIds: state.openIds.join(', '), // for debugging; not intended for structured logging
        reportedPending: result.announcements.map((a) => `${a.id}@v${a.version}`).join(', '), // for debugging; not intended for structured logging
      });

      const { items, nextState } = selectAnnouncements(result, state);
      if (items.length === 0) {
        // The skill has a footprint and reported pending capabilities, but none are
        // new (version > seenVersion) or resumable (in openIds) — so the returning
        // customer is shown nothing. Logged to explain otherwise-silent sessions.
        //
        // Still persist the advanced bookmark when it changed, even though nothing
        // surfaced: this completes the one-time legacy-marker migration (so it does
        // not re-run and re-log every session) and prunes now-built capabilities out
        // of `openIds` on the session they are detected, instead of waiting for the
        // next surfaced announcement (which may never come).
        if (announceStateChanged(state, nextState)) {
          await kv.set(scope, stateKey, nextState);
        }
        logger.info('skill.announcements.none_surfaced', {
          appId,
          skillName,
          seenVersion: state.seenVersion,
          currentVersion: result.currentVersion,
          reportedPendingCount: result.announcements.length,
          reason: 'nothing-new-or-resumed',
        });
        continue;
      }

      messages.push(buildAnnouncementContextMessage(items));

      await kv.set(scope, stateKey, nextState);
      logger.info('skill.announcements.surfaced', {
        appId,
        skillName,
        count: items.length,
        newCount: items.filter((i) => i.reason === 'new').length,
        resumedCount: items.filter((i) => i.reason === 'resumed').length,
        seenVersion: state.seenVersion,
        nextVersion: nextState.seenVersion,
      });
    } catch (error) {
      logger.warn('skill.announcements.skill_failed', {
        appId,
        skillName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return messages;
}