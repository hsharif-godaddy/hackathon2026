import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../goal-tracker.js';
import type { ScenarioGoal } from '../../scenarios/types.js';

const pos = (desc: string): ScenarioGoal => ({
  description: desc,
  assertion: 'positive',
});

const neg = (desc: string): ScenarioGoal => ({
  description: desc,
  assertion: 'negative',
});

describe('GoalTracker', () => {
  describe('constructor', () => {
    it('partitions positive and negative goals', () => {
      const tracker = new GoalTracker([
        pos('goal A'),
        neg('avoid X'),
        pos('goal B'),
      ]);
      expect(tracker.nextGoal()?.description).toBe('goal A');
      expect(tracker.allPositiveRequested()).toBe(false);
    });

    it('handles empty goals array', () => {
      const tracker = new GoalTracker([]);
      expect(tracker.nextGoal()).toBeNull();
      expect(tracker.allPositiveRequested()).toBe(true);
    });

    it('handles all-negative goals', () => {
      const tracker = new GoalTracker([neg('avoid X'), neg('avoid Y')]);
      expect(tracker.nextGoal()).toBeNull();
      expect(tracker.allPositiveRequested()).toBe(true);
    });
  });

  describe('nextGoal', () => {
    it('returns first unrequested positive goal', () => {
      const tracker = new GoalTracker([
        pos('goal A'),
        pos('goal B'),
        pos('goal C'),
      ]);
      expect(tracker.nextGoal()?.description).toBe('goal A');
    });

    it('returns same goal before markRequested is called', () => {
      const tracker = new GoalTracker([pos('goal A'), pos('goal B')]);
      expect(tracker.nextGoal()?.description).toBe('goal A');
      expect(tracker.nextGoal()?.description).toBe('goal A');
    });

    it('returns next unrequested goal after marking', () => {
      const tracker = new GoalTracker([pos('goal A'), pos('goal B')]);
      tracker.markRequested(0);
      expect(tracker.nextGoal()?.description).toBe('goal B');
    });

    it('returns null when all positive goals are requested', () => {
      const tracker = new GoalTracker([pos('goal A')]);
      tracker.markRequested(0);
      expect(tracker.nextGoal()).toBeNull();
    });

    it('skips negative goals', () => {
      const tracker = new GoalTracker([neg('avoid X'), pos('goal A')]);
      expect(tracker.nextGoal()?.description).toBe('goal A');
    });

    it('uses original array indices for marking', () => {
      // negative at index 0, positive at index 1
      const tracker = new GoalTracker([neg('avoid X'), pos('goal A')]);
      tracker.markRequested(1);
      expect(tracker.nextGoal()).toBeNull();
    });
  });

  describe('markRequested', () => {
    it('marks goal by original array index', () => {
      const tracker = new GoalTracker([
        neg('avoid X'), // index 0
        pos('goal A'),  // index 1
        pos('goal B'),  // index 2
      ]);
      tracker.markRequested(1);
      expect(tracker.nextGoal()?.description).toBe('goal B');
    });

    it('is idempotent for duplicate calls', () => {
      const tracker = new GoalTracker([pos('goal A'), pos('goal B')]);
      tracker.markRequested(0);
      tracker.markRequested(0);
      expect(tracker.nextGoal()?.description).toBe('goal B');
      expect(tracker.allPositiveRequested()).toBe(false);
    });
  });

  describe('allPositiveRequested', () => {
    it('returns false when no goals are requested', () => {
      const tracker = new GoalTracker([pos('goal A')]);
      expect(tracker.allPositiveRequested()).toBe(false);
    });

    it('returns false when only some goals are requested', () => {
      const tracker = new GoalTracker([pos('goal A'), pos('goal B')]);
      tracker.markRequested(0);
      expect(tracker.allPositiveRequested()).toBe(false);
    });

    it('returns true when all positive goals are requested', () => {
      const tracker = new GoalTracker([pos('goal A'), pos('goal B')]);
      tracker.markRequested(0);
      tracker.markRequested(1);
      expect(tracker.allPositiveRequested()).toBe(true);
    });

    it('returns true with no positive goals', () => {
      const tracker = new GoalTracker([]);
      expect(tracker.allPositiveRequested()).toBe(true);
    });

    it('ignores negative goals when checking completion', () => {
      const tracker = new GoalTracker([neg('avoid X'), pos('goal A')]);
      tracker.markRequested(1);
      expect(tracker.allPositiveRequested()).toBe(true);
    });
  });
});

describe('buildGoalPrompt', () => {
  it(
    'shows current goal, pending, and constraints in unrequested mode',
    () => {
      const tracker = new GoalTracker([
        pos('goal A'),
        pos('goal B'),
        neg('avoid X'),
      ]);
      const prompt = tracker.buildGoalPrompt();
      expect(prompt).toContain('Your current goal to request:');
      expect(prompt).toContain('- goal A');
      expect(prompt).toContain('Goals still pending');
      expect(prompt).toContain('- goal B');
      expect(prompt).toContain('Constraints (always apply):');
      expect(prompt).toContain('- AVOID: avoid X');
    },
  );

  it('omits already-requested section when nothing yet requested', () => {
    const tracker = new GoalTracker([pos('goal A'), pos('goal B')]);
    const prompt = tracker.buildGoalPrompt();
    expect(prompt).not.toContain('already requested');
  });

  it('shows already-requested section after marking', () => {
    const tracker = new GoalTracker([
      pos('goal A'),
      pos('goal B'),
      pos('goal C'),
    ]);
    tracker.markRequested(0);
    const prompt = tracker.buildGoalPrompt();
    expect(prompt).toContain('Goals already requested:');
    expect(prompt).toContain('- goal A');
    expect(prompt).toContain('Your current goal to request:');
    expect(prompt).toContain('- goal B');
    expect(prompt).toContain('Goals still pending');
    expect(prompt).toContain('- goal C');
  });

  it('omits pending section when only one unrequested goal remains', () => {
    const tracker = new GoalTracker([pos('goal A')]);
    const prompt = tracker.buildGoalPrompt();
    expect(prompt).not.toContain('pending');
  });

  it('switches to all-requested mode when all goals are marked', () => {
    const tracker = new GoalTracker([pos('goal A'), pos('goal B')]);
    tracker.markRequested(0);
    tracker.markRequested(1);
    const prompt = tracker.buildGoalPrompt();
    expect(prompt).toContain('All goals have been requested:');
    expect(prompt).toContain('- goal A');
    expect(prompt).toContain('- goal B');
    expect(prompt).not.toContain('current goal');
  });

  it('omits constraints section when no negative goals exist', () => {
    const tracker = new GoalTracker([pos('goal A')]);
    const prompt = tracker.buildGoalPrompt();
    expect(prompt).not.toContain('Constraints');
  });

  it('handles all-negative goals (no positive goals)', () => {
    const tracker = new GoalTracker([neg('avoid X')]);
    const prompt = tracker.buildGoalPrompt();
    // allPositiveRequested() is true with no positive goals -> all-requested
    // mode, but no "All goals have been requested:" heading since list is empty
    expect(prompt).toContain('Constraints (always apply):');
    expect(prompt).toContain('- AVOID: avoid X');
    expect(prompt).not.toContain('All goals have been requested:');
  });

  it('returns empty string for empty goals array', () => {
    const tracker = new GoalTracker([]);
    expect(tracker.buildGoalPrompt()).toBe('');
  });

  it('handles mixed positive/negative ordering', () => {
    const tracker = new GoalTracker([
      neg('avoid X'), // index 0
      pos('goal A'), // index 1
      neg('avoid Y'), // index 2
      pos('goal B'), // index 3
    ]);
    const prompt = tracker.buildGoalPrompt();
    expect(prompt).toContain('Your current goal to request:');
    expect(prompt).toContain('- goal A');
    expect(prompt).toContain('Goals still pending');
    expect(prompt).toContain('- goal B');
    expect(prompt).toContain('Constraints (always apply):');
    expect(prompt).toContain('- AVOID: avoid X');
    expect(prompt).toContain('- AVOID: avoid Y');
  });
});
