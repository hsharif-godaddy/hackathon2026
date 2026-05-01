import assume from 'assume';
import { describe, it } from 'node:test';

import { FRICTION_PATTERN_TYPES, ScenarioSchema } from './types.js';

describe('ScenarioSchema', () => {
  // Minimal valid scenario base for reuse
  const base = {
    name: 'test-scenario',
    startUrl: 'https://example.com',
    goal: 'Test goal',
  };

  describe('expectedFrictionPatterns enum validation', () => {
    it('accepts valid friction pattern types', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        expectedFrictionPatterns: ['EDIT_LOOP', 'USER_CORRECTION'],
      });
      assume(result.success).is.true();
    });

    it('accepts all known pattern types', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        expectedFrictionPatterns: [...FRICTION_PATTERN_TYPES],
      });
      assume(result.success).is.true();
    });

    it('rejects misspelled pattern types at parse time', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        expectedFrictionPatterns: ['USER_CORECTION'], // typo
      });
      assume(result.success).is.false();
    });

    it('rejects unknown pattern types', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        expectedFrictionPatterns: ['UNKNOWN_PATTERN'],
      });
      assume(result.success).is.false();
    });

    it('rejects non-string values in the array', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        expectedFrictionPatterns: [123],
      });
      assume(result.success).is.false();
    });

    it('accepts empty array', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        expectedFrictionPatterns: [],
      });
      assume(result.success).is.true();
    });

    it('accepts omitted expectedFrictionPatterns', () => {
      const result = ScenarioSchema.safeParse(base);
      assume(result.success).is.true();
    });
  });

  describe('minChatMessages validation', () => {
    it('rejects minChatMessages without creditLimit', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        minChatMessages: 2,
        chatMessages: ['hello'],
      });
      assume(result.success).is.false();
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join('; ');
        assume(msg).includes('minChatMessages requires creditLimit');
      }
    });

    it('accepts minChatMessages with creditLimit and chatMessages', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        creditLimit: 5,
        chatMessages: ['hello', 'world'],
        minChatMessages: 2,
      });
      assume(result.success).is.true();
    });

    it('rejects minChatMessages of 0', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        creditLimit: 5,
        chatMessages: ['hello'],
        minChatMessages: 0,
      });
      assume(result.success).is.false();
    });

    it('rejects non-integer minChatMessages', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        creditLimit: 5,
        chatMessages: ['hello'],
        minChatMessages: 1.5,
      });
      assume(result.success).is.false();
    });
  });

  describe('creditLimit / chatMessages refine', () => {
    it('rejects creditLimit without chatMessages', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        creditLimit: 5,
      });
      assume(result.success).is.false();
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join('; ');
        assume(msg).includes('creditLimit requires a non-empty chatMessages array');
      }
    });

    it('rejects creditLimit with empty chatMessages', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        creditLimit: 5,
        chatMessages: [],
      });
      assume(result.success).is.false();
    });

    it('accepts creditLimit with chatMessages', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        creditLimit: 5,
        chatMessages: ['build me a site'],
      });
      assume(result.success).is.true();
    });
  });

  describe('FRICTION_PATTERN_TYPES constant', () => {
    it('includes USER_CORRECTION', () => {
      assume(FRICTION_PATTERN_TYPES).includes('USER_CORRECTION');
    });

    it('includes EDIT_LOOP', () => {
      assume(FRICTION_PATTERN_TYPES).includes('EDIT_LOOP');
    });
  });

  describe('frictionPatternMatchMode default', () => {
    it('defaults to "any" when not specified', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        expectedFrictionPatterns: ['USER_CORRECTION'],
      });
      assume(result.success).is.true();
      if (result.success) {
        assume(result.data.frictionPatternMatchMode).equals('any');
      }
    });

    it('accepts explicit "all" mode', () => {
      const result = ScenarioSchema.safeParse({
        ...base,
        expectedFrictionPatterns: ['USER_CORRECTION'],
        frictionPatternMatchMode: 'all',
      });
      assume(result.success).is.true();
      if (result.success) {
        assume(result.data.frictionPatternMatchMode).equals('all');
      }
    });
  });
});
