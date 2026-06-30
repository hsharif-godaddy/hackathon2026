import { describe, it, expect } from 'vitest';

import {
  computeCasingViolations,
  type RawCasingNode,
} from '../casing.js';

function node(overrides: Partial<RawCasingNode> = {}): RawCasingNode {
  return {
    selector: 'span',
    className: '',
    text: 'our services',
    textTransform: 'none',
    letterSpacingPx: null,
    fontPx: 13,
    bold: false,
    ...overrides,
  };
}

describe('computeCasingViolations', () => {
  it('flags a small short element rendered uppercase via text-transform', () => {
    const { violations, textNodesScanned } = computeCasingViolations([
      node({ textTransform: 'uppercase', text: 'our services', fontPx: 13 }),
    ]);
    expect(textNodesScanned).toBe(1);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.tokenGuess).toBe('label');
  });

  it('classifies a wide-tracked uppercase eyebrow-class element as an eyebrow', () => {
    const { violations } = computeCasingViolations([
      node({
        className: 'section-eyebrow',
        textTransform: 'uppercase',
        text: 'what we do',
        fontPx: 12,
        letterSpacingPx: 1.8, // 0.15em at 12px → wide tracking
      }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.tokenGuess).toBe('eyebrow');
    expect(violations[0]!.wideTracking).toBe(true);
  });

  it('flags literal ALL-CAPS multi-word source text (no transform)', () => {
    const { violations } = computeCasingViolations([
      node({ text: 'NEW FEATURE', textTransform: 'none', fontPx: 12 }),
    ]);
    expect(violations).toHaveLength(1);
  });

  it('does NOT flag a single-token all-caps acronym (FAQ)', () => {
    const { violations } = computeCasingViolations([
      node({ text: 'FAQ', textTransform: 'none', fontPx: 13 }),
    ]);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag an uppercase large display headline (not an eyebrow)', () => {
    const { violations } = computeCasingViolations([
      node({ text: 'build better', textTransform: 'uppercase', fontPx: 40, bold: true }),
    ]);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag lowercase small short text (the desired kit casing)', () => {
    const { violations } = computeCasingViolations([
      node({ text: 'our services', textTransform: 'none', fontPx: 13 }),
    ]);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag uppercase long body copy (not label-like)', () => {
    const { violations } = computeCasingViolations([
      node({
        text: 'THIS IS A LONG UPPERCASE SENTENCE THAT IS CLEARLY BODY COPY NOT AN EYEBROW LABEL',
        textTransform: 'uppercase',
        fontPx: 13,
      }),
    ]);
    expect(violations).toHaveLength(0);
  });

  it('flags an uppercase element carrying an eyebrow class even at a slightly larger size', () => {
    const { violations } = computeCasingViolations([
      node({ className: 'kicker', textTransform: 'uppercase', text: 'introducing', fontPx: 20 }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.tokenGuess).toBe('eyebrow');
  });

  it('does NOT flag a headline-sized uppercase element even with an eyebrow class', () => {
    const { violations } = computeCasingViolations([
      node({ className: 'kicker', textTransform: 'uppercase', text: 'introducing', fontPx: 28 }),
    ]);
    expect(violations).toHaveLength(0);
  });

  it('reports letterSpacingEm and wideTracking=false for narrow tracking', () => {
    const { violations } = computeCasingViolations([
      node({ textTransform: 'uppercase', text: 'our team', fontPx: 12, letterSpacingPx: 0.12 }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.wideTracking).toBe(false);
    expect(violations[0]!.letterSpacingEm).toBeCloseTo(0.01, 3);
  });
});
