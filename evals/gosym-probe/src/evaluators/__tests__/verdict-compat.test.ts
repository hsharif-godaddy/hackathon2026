import { describe, it, expect } from 'vitest';
import { LEGACY_VERDICT_MAP, mapLegacyVerdict } from '../verdict-compat.js';
import type { EvalResult } from '../evaluator.js';

describe('mapLegacyVerdict', () => {
  const legacyCases: ReadonlyArray<[string, EvalResult['verdict']]> = [
    ['partial', 'fail'],
    ['unknown', 'incomplete'],
    ['observed', 'directional'],
  ];

  for (const [raw, expected] of legacyCases) {
    it(`maps legacy '${raw}' to '${expected}'`, () => {
      const output: EvalResult['verdict'] = mapLegacyVerdict(raw);
      expect(output).toBe(expected);
    });
  }

  const validVerdicts: ReadonlyArray<EvalResult['verdict']> = [
    'pass',
    'fail',
    'incomplete',
    'directional',
  ];

  for (const verdict of validVerdicts) {
    it(`passes through valid verdict '${verdict}' unchanged`, () => {
      const output: EvalResult['verdict'] = mapLegacyVerdict(verdict);
      expect(output).toBe(verdict);
    });
  }

  const unrecognized: readonly string[] = ['garbage', ''];

  for (const raw of unrecognized) {
    it(`falls back to 'incomplete' for unrecognized '${raw}'`, () => {
      const output: EvalResult['verdict'] = mapLegacyVerdict(raw);
      expect(output).toBe('incomplete');
    });
  }
});

describe('LEGACY_VERDICT_MAP', () => {
  it('contains exactly the three legacy entries', () => {
    expect(LEGACY_VERDICT_MAP.size).toBe(3);
  });

  it('maps each legacy token to its target verdict', () => {
    expect(LEGACY_VERDICT_MAP.get('partial')).toBe('fail');
    expect(LEGACY_VERDICT_MAP.get('unknown')).toBe('incomplete');
    expect(LEGACY_VERDICT_MAP.get('observed')).toBe('directional');
  });
});
