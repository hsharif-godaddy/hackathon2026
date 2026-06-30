import { describe, it, expect } from 'vitest';

import {
  relativeLuminance,
  contrastRatio,
  isLargeText,
  classifyToken,
  computeContrastViolations,
  type RawTextNode,
} from '../contrast.js';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white (order-independent)', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 2);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 2);
  });

  it('is 1:1 for identical colors', () => {
    expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 5);
  });

  it('matches a known mid-gray pair (#767676 on white ~= 4.54:1, the AA boundary)', () => {
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 1);
  });
});

describe('isLargeText (WCAG: >=24px, or >=18.66px bold)', () => {
  it('classifies normal vs large', () => {
    expect(isLargeText(16, false)).toBe(false);
    expect(isLargeText(24, false)).toBe(true);
    expect(isLargeText(18.66, true)).toBe(true);
    expect(isLargeText(16, true)).toBe(false);
  });
});

describe('classifyToken', () => {
  it('attributes low-emphasis classes/vars', () => {
    expect(classifyToken('text-muted-foreground px-2')).toBe('muted');
    expect(classifyToken('text-[color:var(--ink-tertiary)]')).toBe('tertiary');
    expect(classifyToken('text-ink-tertiary')).toBe('tertiary');
    expect(classifyToken('text-foreground font-bold')).toBe('other');
    expect(classifyToken('')).toBe('other');
  });
});

describe('computeContrastViolations', () => {
  const base: Omit<RawTextNode, 'fg' | 'bg' | 'className' | 'bgIndeterminate'> = {
    selector: 'p',
    fontPx: 16,
    bold: false,
  };

  it('flags a failing muted-on-light pair with tokenGuess muted', () => {
    const nodes: RawTextNode[] = [
      { ...base, className: 'text-muted-foreground', fg: [153, 153, 153], bg: [255, 255, 255], bgIndeterminate: false },
    ];
    const v = computeContrastViolations(nodes);
    expect(v).toHaveLength(1);
    expect(v[0]!.tokenGuess).toBe('muted');
    expect(v[0]!.ratio).toBeLessThan(4.5);
    expect(v[0]!.requiredRatio).toBe(4.5);
  });

  it('does NOT flag a passing pair (dark text on white)', () => {
    const nodes: RawTextNode[] = [
      { ...base, className: 'text-foreground', fg: [20, 20, 20], bg: [255, 255, 255], bgIndeterminate: false },
    ];
    expect(computeContrastViolations(nodes)).toHaveLength(0);
  });

  it('does NOT flag white-on-dark (no dark-section false positive)', () => {
    const nodes: RawTextNode[] = [
      { ...base, className: 'text-white', fg: [255, 255, 255], bg: [10, 10, 10], bgIndeterminate: false },
    ];
    expect(computeContrastViolations(nodes)).toHaveLength(0);
  });

  it('uses the 3:1 threshold for large text', () => {
    // ratio ~3.9 — fails normal (4.5) but passes large (3.0)
    const fg: [number, number, number] = [130, 130, 130];
    const bg: [number, number, number] = [255, 255, 255];
    expect(computeContrastViolations([{ ...base, className: 'x', fg, bg, bgIndeterminate: false }])).toHaveLength(1);
    expect(computeContrastViolations([{ ...base, fontPx: 28, className: 'x', fg, bg, bgIndeterminate: false }])).toHaveLength(0);
  });

  it('surfaces indeterminate backgrounds without a pass/fail', () => {
    const nodes: RawTextNode[] = [
      { ...base, className: 'text-muted-foreground', fg: [153, 153, 153], bg: [0, 0, 0], bgIndeterminate: true },
    ];
    const v = computeContrastViolations(nodes);
    expect(v).toHaveLength(1);
    expect(v[0]!.tokenGuess).toBe('indeterminate-bg');
  });
});
