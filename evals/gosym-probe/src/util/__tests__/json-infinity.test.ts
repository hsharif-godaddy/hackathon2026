import { describe, it, expect } from 'vitest';
import { jsonReplacer, jsonReviver } from '../json-infinity.js';

const roundTrip = <T>(value: T): unknown =>
  JSON.parse(JSON.stringify(value, jsonReplacer), jsonReviver);

describe('json-infinity', () => {
  it('round-trips Infinity and -Infinity (raw JSON would lose them to null)', () => {
    expect(JSON.stringify(Infinity)).toBe('null'); // documents the bug being guarded
    expect(roundTrip(Infinity)).toBe(Infinity);
    expect(roundTrip(-Infinity)).toBe(-Infinity);
  });

  it('preserves Infinity nested where mdeScore actually lives', () => {
    // Mirrors regressionStatus → statistical.power.mdeScore in aggregated.json.
    const stored = {
      evaluators: [
        { evaluator: 'jtbd-completion', statistical: { power: { mdeScore: Infinity, achievedPower: 0 } } },
      ],
    };
    const out = roundTrip(stored) as typeof stored;
    expect(out.evaluators[0].statistical.power.mdeScore).toBe(Infinity);
    expect(out.evaluators[0].statistical.power.achievedPower).toBe(0);
  });

  it('leaves finite numbers, strings, null, and booleans untouched', () => {
    const value = { a: 0.886, b: -1.5, c: 'ok', d: null, e: true, f: [1, 2, 3] };
    expect(roundTrip(value)).toEqual(value);
  });

  it('does not encode NaN — it still degrades to null (documented limitation)', () => {
    // The power block can never be NaN, so this is a known, accepted gap.
    expect(roundTrip(NaN)).toBeNull();
  });

  it('reviver decodes the reserved sentinel strings if they appear verbatim', () => {
    // Negligible for internal eval data; asserted so the reserved tokens are explicit.
    expect(jsonReviver('k', '__Infinity__')).toBe(Infinity);
    expect(jsonReviver('k', '__-Infinity__')).toBe(-Infinity);
    expect(jsonReviver('k', 'ordinary')).toBe('ordinary');
  });
});
