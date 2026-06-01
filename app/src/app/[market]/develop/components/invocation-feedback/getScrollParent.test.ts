/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { getScrollParent } from './getScrollParent';

describe('getScrollParent', function getScrollParentTests() {
  it('returns the nearest ancestor with scrollable overflow', function scrollable() {
    const root = document.createElement('div');
    const scrollParent = document.createElement('div');
    const child = document.createElement('div');

    scrollParent.style.overflowY = 'auto';
    scrollParent.style.height = '100px';
    Object.defineProperty(scrollParent, 'scrollHeight', { value: 200, configurable: true });
    Object.defineProperty(scrollParent, 'clientHeight', { value: 100, configurable: true });

    root.appendChild(scrollParent);
    scrollParent.appendChild(child);
    document.body.appendChild(root);

    expect(getScrollParent(child)).toBe(scrollParent);

    document.body.removeChild(root);
  });

  it('returns null when no scrollable parent exists', function none() {
    const child = document.createElement('div');
    document.body.appendChild(child);
    expect(getScrollParent(child)).toBeNull();
    document.body.removeChild(child);
  });
});
