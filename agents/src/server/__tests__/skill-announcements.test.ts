import { describe, it, expect } from 'vitest';
import type { SkillSessionAnnouncements } from '@airo/ai-skills';
import {
  emptyAnnounceState,
  selectAnnouncements,
  renderAnnouncementMessage,
  buildAnnouncementContextMessage,
  type SelectedAnnouncement,
  type SkillAnnounceState,
} from '../skill-announcements.js';

/** Build a pending-capabilities report (the not-built items the hook returns). */
function report(
  currentVersion: number,
  items: Array<{ id: string; version: number }>,
): SkillSessionAnnouncements {
  return {
    currentVersion,
    announcements: items.map((i) => ({
      id: i.id,
      label: `Feature ${i.id}`,
      summary: `does ${i.id}`,
      version: i.version,
    })),
  };
}

function selected(
  reason: SelectedAnnouncement['reason'],
  id: string,
  version: number,
): SelectedAnnouncement {
  return { id, label: `Feature ${id}`, summary: `does ${id}`, version, reason };
}

describe('selectAnnouncements', () => {
  it('returns nothing and keeps state when the hook reported null', () => {
    const state: SkillAnnounceState = { seenVersion: 5, openIds: ['x'] };
    const { items, nextState } = selectAnnouncements(null, state);
    expect(items).toHaveLength(0);
    expect(nextState).toBe(state);
  });

  it('marks every pending capability NEW for a never-seen customer and opens them all', () => {
    const { items, nextState } = selectAnnouncements(
      report(3, [
        { id: 'a', version: 1 },
        { id: 'b', version: 2 },
        { id: 'c', version: 3 },
      ]),
      emptyAnnounceState(),
    );
    expect(items.map((i) => [i.id, i.reason])).toEqual([
      ['a', 'new'],
      ['b', 'new'],
      ['c', 'new'],
    ]);
    expect(nextState).toEqual({ seenVersion: 3, openIds: ['a', 'b', 'c'] });
  });

  it('RESUMES an announced-but-unbuilt capability on the next visit (the bug fix)', () => {
    // Customer was caught up to v3 and was told about 'c', but never built it.
    const state: SkillAnnounceState = { seenVersion: 3, openIds: ['c'] };
    const { items, nextState } = selectAnnouncements(report(3, [{ id: 'c', version: 3 }]), state);
    expect(items).toEqual([selected('resumed', 'c', 3)]);
    expect(nextState).toEqual({ seenVersion: 3, openIds: ['c'] });
  });

  it('drops a capability from the open set once the customer has built it', () => {
    // 'c' is no longer pending (built) -> not returned by the hook.
    const state: SkillAnnounceState = { seenVersion: 3, openIds: ['c'] };
    const { items, nextState } = selectAnnouncements(report(3, []), state);
    expect(items).toHaveLength(0);
    expect(nextState.openIds).toEqual([]);
  });

  it('shows NEW first, caps the display, but still opens every new item so capped ones resume later', () => {
    const state: SkillAnnounceState = { seenVersion: 2, openIds: ['x'] };
    const r = report(4, [
      { id: 'x', version: 1 }, // previously announced, still pending -> resumed
      { id: 'y', version: 3 }, // new
      { id: 'z', version: 4 }, // new
      { id: 'w', version: 4 }, // new
    ]);
    const { items, nextState } = selectAnnouncements(r, state);
    // Display caps at 3, new-first, so the resumed 'x' is pushed out THIS round...
    expect(items.map((i) => [i.id, i.reason])).toEqual([
      ['y', 'new'],
      ['z', 'new'],
      ['w', 'new'],
    ]);
    // ...but x (still pending) AND every new item stay open.
    expect(nextState.seenVersion).toBe(4);
    expect([...nextState.openIds].sort()).toEqual(['w', 'x', 'y', 'z']);

    // Next visit, with nothing built: the previously-capped items now resume
    // (they are no longer "new" since seenVersion advanced) — none vanish.
    const next = selectAnnouncements(report(4, r.announcements.map((a) => ({ id: a.id, version: a.version }))), nextState);
    expect(next.items.every((i) => i.reason === 'resumed')).toBe(true);
    expect(next.items.length).toBe(3);
  });

  it('respects a custom display cap', () => {
    const { items } = selectAnnouncements(
      report(2, [
        { id: 'a', version: 1 },
        { id: 'b', version: 2 },
      ]),
      emptyAnnounceState(),
      1,
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('a');
  });
});

describe('renderAnnouncementMessage', () => {
  it('groups new vs resumed and instructs use of suggestedResponse without leaking internals', () => {
    const message = renderAnnouncementMessage([
      selected('new', 'a', 2),
      selected('resumed', 'b', 1),
    ]);
    expect(message).toContain('New since your last visit');
    expect(message).toContain('Pick up where you left off');
    expect(message).toContain('Feature a');
    expect(message).toContain('Feature b');
    expect(message).toContain('suggestedResponse');
    expect(message).toContain('never mention internal tool or skill names');
  });

  it('omits the resumed section when there are no resumed items', () => {
    const message = renderAnnouncementMessage([selected('new', 'a', 1)]);
    expect(message).toContain('New since your last visit');
    expect(message).not.toContain('Pick up where you left off');
  });
});

describe('buildAnnouncementContextMessage', () => {
  // Regression guard: the announcement MUST be injected as a user-role
  // before_history message. A system role here re-introduces the Anthropic
  // "Multiple system messages separated by user/assistant messages" crash on
  // long sessions, where a user-role conversation summary already sits in the
  // before_history bucket ahead of it.
  it('is a user-role before_history message (never system)', () => {
    const message = buildAnnouncementContextMessage([selected('new', 'a', 1)]);
    expect(message.role).toBe('user');
    expect(message.insertionOrder).toBe('before_history');
  });

  it('carries the rendered announcement body', () => {
    const message = buildAnnouncementContextMessage([
      selected('new', 'a', 1),
      selected('resumed', 'b', 1),
    ]);
    expect(message.content).toContain('Feature a');
    expect(message.content).toContain('Feature b');
  });
});
