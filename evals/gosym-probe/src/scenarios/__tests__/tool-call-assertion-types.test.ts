import { describe, it, expect } from 'vitest';
import type { ToolCallAssertion } from '../types.js';

// AC-1: a primitive-valued args assertion is valid.
const primitiveArgs: ToolCallAssertion = {
  tool: 'handoff',
  called: false,
  args: { targetAgent: 'marketing', attempt: 1, force: true, note: null },
};

// AC-1: a non-primitive (object/array) args value must be a COMPILE error,
// so the evaluator's strict `===` can never silently mis-score. Verified by
// `tsc --noEmit`; if the constraint is missing, the @ts-expect-error is unused
// and tsc fails on the directive.
const objectArg: ToolCallAssertion = {
  tool: 'handoff',
  called: false,
  // @ts-expect-error - object arg value is not an AssertionArgValue
  args: { channels: { primary: 'social' } },
};
const arrayArg: ToolCallAssertion = {
  tool: 'handoff',
  called: false,
  // @ts-expect-error - array arg value is not an AssertionArgValue
  args: { channels: ['social', 'email'] },
};

describe('ToolCallAssertion.args primitive constraint (AC-1)', () => {
  it('accepts primitive arg values', () => {
    expect(primitiveArgs.args?.targetAgent).toBe('marketing');
  });
  it('keeps the rejected shapes referenced (type-only assertions)', () => {
    expect([objectArg, arrayArg]).toHaveLength(2);
  });
});
