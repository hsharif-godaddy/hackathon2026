/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { getElementClassName } from '../utils/element-helpers';

describe('getElementClassName', () => {
  it('returns the className string for an HTML element', () => {
    const el = document.createElement('div');
    el.className = 'foo bar';
    expect(typeof getElementClassName(el)).toBe('string');
    expect(getElementClassName(el)).toBe('foo bar');
  });

  it('returns a plain string for an SVG element whose className is SVGAnimatedString', () => {
    // Regression guard: `SVGElement.className` is an `SVGAnimatedString`,
    // which is NOT structured-cloneable. Shipping it across postMessage
    // throws DataCloneError — the root cause of the original overlay
    // loop this helper exists to prevent. `classList.toString()` is
    // defined on Element and returns a plain string on both HTML and
    // SVG, so the helper must yield `string` here.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon highlight');
    const result = getElementClassName(svg);
    expect(typeof result).toBe('string');
    expect(result.split(' ').sort()).toEqual(['highlight', 'icon']);
  });

  it('returns an empty string for an element without any class', () => {
    const el = document.createElement('span');
    expect(getElementClassName(el)).toBe('');
  });
});
