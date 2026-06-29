import { describe, it, expect } from 'vitest';
import type { BaselineEvalScores } from '../types.js';
import type { PassEstimatorEntry } from '../../util/pass-at-k.js';

describe('pass estimator JSON round-trip', () => {
  it('PassEstimatorEntry[] survives JSON serialize/parse with numeric k intact', () => {
    const original: BaselineEvalScores = {
      passAt1: 0.6,
      passAtK: [
        { k: 1, value: 0.6 },
        { k: 2, value: 0.9 },
        { k: 3, value: 0.97 },
      ],
      passHatK: [
        { k: 1, value: 0.6 },
        { k: 2, value: 0.3 },
        { k: 3, value: 0.1 },
      ],
      passingTrials: 3,
      totalTrials: 5,
    };

    const json: string = JSON.stringify(original);
    const parsed: BaselineEvalScores = JSON.parse(json) as BaselineEvalScores;

    expect(parsed.passAt1).toBe(0.6);
    expect(parsed.passAtK).toEqual([
      { k: 1, value: 0.6 },
      { k: 2, value: 0.9 },
      { k: 3, value: 0.97 },
    ]);
    expect(parsed.passHatK).toEqual([
      { k: 1, value: 0.6 },
      { k: 2, value: 0.3 },
      { k: 3, value: 0.1 },
    ]);
  });

  it('numeric k fields stay numbers after round-trip (no string-key coercion)', () => {
    const original: PassEstimatorEntry[] = [
      { k: 1, value: 0.5 },
      { k: 2, value: 0.8 },
      { k: 5, value: 0.99 },
    ];
    const parsed: PassEstimatorEntry[] = JSON.parse(
      JSON.stringify(original),
    ) as PassEstimatorEntry[];

    expect(parsed.map((entry: PassEstimatorEntry) => entry.k)).toEqual([
      1, 2, 5,
    ]);

    for (const entry of parsed) {
      expect(typeof entry.k).toBe('number');
    }

    for (let i: number = 0; i < parsed.length; i++) {
      expect(parsed[i].k).toBe(original[i].k);
      expect(parsed[i].value).toBe(original[i].value);
    }
  });

  it('preserves array ordering through round-trip', () => {
    const original: BaselineEvalScores = {
      passAtK: [
        { k: 5, value: 0.99 },
        { k: 1, value: 0.5 },
        { k: 2, value: 0.8 },
      ],
      passingTrials: 3,
      totalTrials: 5,
    };

    const parsed: BaselineEvalScores = JSON.parse(
      JSON.stringify(original),
    ) as BaselineEvalScores;

    expect(parsed.passAtK!.map((entry: PassEstimatorEntry) => entry.k)).toEqual(
      [5, 1, 2],
    );
    expect(typeof parsed.passAtK![0].k).toBe('number');
  });

  it('handles empty estimator fields gracefully', () => {
    const original: BaselineEvalScores = {
      passingTrials: 0,
      totalTrials: 0,
    };

    const parsed: BaselineEvalScores = JSON.parse(
      JSON.stringify(original),
    ) as BaselineEvalScores;

    expect(parsed.passAt1).toBeUndefined();
    expect(parsed.passAtK).toBeUndefined();
    expect(parsed.passHatK).toBeUndefined();
  });

  it('handles empty estimator arrays', () => {
    const original: BaselineEvalScores = {
      passAtK: [],
      passHatK: [],
      passingTrials: 0,
      totalTrials: 0,
    };

    const parsed: BaselineEvalScores = JSON.parse(
      JSON.stringify(original),
    ) as BaselineEvalScores;

    expect(parsed.passAtK).toEqual([]);
    expect(parsed.passHatK).toEqual([]);
  });

  it('preserves numeric precision through round-trip', () => {
    const original: BaselineEvalScores = {
      passAt1: 1 / 3,
      passAtK: [
        { k: 1, value: 1 / 3 },
        { k: 2, value: 5 / 9 },
      ],
      passHatK: [
        { k: 1, value: 1 / 3 },
        { k: 2, value: 1 / 9 },
      ],
      passingTrials: 1,
      totalTrials: 3,
    };

    const parsed: BaselineEvalScores = JSON.parse(
      JSON.stringify(original),
    ) as BaselineEvalScores;

    expect(parsed.passAt1).toBeCloseTo(1 / 3);
    expect(parsed.passAtK![0].value).toBeCloseTo(1 / 3);
    expect(parsed.passAtK![1].value).toBeCloseTo(5 / 9);
    expect(parsed.passHatK![0].value).toBeCloseTo(1 / 3);
    expect(parsed.passHatK![1].value).toBeCloseTo(1 / 9);
    expect(typeof parsed.passAtK![0].k).toBe('number');
  });
});
