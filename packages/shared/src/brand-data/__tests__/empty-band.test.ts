import { describe, it, expect } from 'vitest';

import { computeEmptyBands, classifyBand, type RawBandNode } from '../empty-band.js';

function band(overrides: Partial<RawBandNode> = {}): RawBandNode {
  return {
    selector: 'section',
    className: '',
    tag: 'section',
    fullBleed: true,
    heightPx: 200,
    hasText: false,
    hasMedia: false,
    hasHr: false,
    ...overrides,
  };
}

describe('computeEmptyBands', () => {
  it('flags a tall full-bleed band with no text and no media', () => {
    const { violations, bandsScanned } = computeEmptyBands([
      band({ tag: 'div', fullBleed: true, heightPx: 240 }),
    ]);
    expect(bandsScanned).toBe(1);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('full-bleed-band');
  });

  it('flags a tall empty <hr> divider band as a divider', () => {
    const { violations } = computeEmptyBands([
      band({ tag: 'hr', fullBleed: false, hasHr: true, heightPx: 160 }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('divider');
  });

  it('flags a tall empty <section> as an empty-section', () => {
    const { violations } = computeEmptyBands([
      band({ tag: 'section', fullBleed: false, heightPx: 120 }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('empty-section');
  });

  it('does NOT flag a band that wraps rendered text', () => {
    const { violations } = computeEmptyBands([band({ hasText: true })]);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag a band that wraps foreground media', () => {
    const { violations } = computeEmptyBands([band({ hasText: false, hasMedia: true })]);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag a thin <hr> between two populated sections (below band height)', () => {
    const { violations } = computeEmptyBands([
      band({ tag: 'hr', fullBleed: false, hasHr: true, heightPx: 2 }),
    ]);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag a short empty spacer (below band height)', () => {
    const { violations } = computeEmptyBands([band({ heightPx: 24 })]);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag a non-band element (plain div, not full-bleed, no hr)', () => {
    expect(classifyBand(band({ tag: 'div', fullBleed: false, hasHr: false, heightPx: 300 }))).toBeNull();
  });

  it('reports the bands-scanned denominator so a clean score is interpretable', () => {
    const { violations, bandsScanned } = computeEmptyBands([
      band({ hasText: true }),
      band({ hasMedia: true }),
      band({ heightPx: 10 }),
    ]);
    expect(violations).toHaveLength(0);
    expect(bandsScanned).toBe(3);
  });
});
