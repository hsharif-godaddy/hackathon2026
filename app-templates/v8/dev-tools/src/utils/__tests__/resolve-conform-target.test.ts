/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { resolveConformTarget } from '../element-detection.js';

function buildConformable(arrayName: string, page: string, child?: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.setAttribute('data-dev-conformable-array', arrayName);
  div.setAttribute('data-dev-conformable-page', page);
  if (child) div.appendChild(child);
  document.body.appendChild(div);
  return div;
}

describe('resolveConformTarget', () => {
  it('returns {page, arrayName} for the conformable root itself', () => {
    const el = buildConformable('stats', 'src/pages/index.tsx');
    expect(resolveConformTarget(el)).toEqual({ page: 'src/pages/index.tsx', arrayName: 'stats' });
  });

  it('returns {page, arrayName} for a child inside a conformable root', () => {
    const child = document.createElement('p');
    child.textContent = 'child';
    buildConformable('features', 'src/pages/about.tsx', child);
    expect(resolveConformTarget(child)).toEqual({ page: 'src/pages/about.tsx', arrayName: 'features' });
  });

  it('returns null when data-dev-conformable-page is missing', () => {
    const el = document.createElement('div');
    el.setAttribute('data-dev-conformable-array', 'stats');
    document.body.appendChild(el);
    expect(resolveConformTarget(el)).toBeNull();
  });

  it('returns null when neither attribute is present', () => {
    const el = document.createElement('p');
    el.textContent = 'plain text';
    document.body.appendChild(el);
    expect(resolveConformTarget(el)).toBeNull();
  });
});
