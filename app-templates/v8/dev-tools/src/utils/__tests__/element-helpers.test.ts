/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { extractDevContext } from '../element-helpers.js';

function buildTree(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return doc.body.firstElementChild as HTMLElement;
}

describe('extractDevContext', () => {
  it("uses the element's OWN dev attributes when it carries them", () => {
    const root = buildTree(
      '<section data-dev-file="/app/src/pages/index.tsx" data-dev-line="10" data-dev-id="aaaaaa">' +
        '<h1 data-dev-file="/app/src/pages/index.tsx" data-dev-line="12" data-dev-id="bbbbbb">Title</h1>' +
        '</section>',
    );
    const heading = root.querySelector('h1') as HTMLElement;
    const ctx = extractDevContext(heading);
    expect(ctx).toBeDefined();
    expect(ctx?.devId).toBe('bbbbbb');
    expect(ctx?.lineNumber).toBe(12);
  });

  it("walks up to an ancestor only when the element lacks its own dev attributes", () => {
    const root = buildTree(
      '<section data-dev-file="/app/src/pages/index.tsx" data-dev-line="10" data-dev-id="aaaaaa">' +
        '<span>inner</span>' +
        '</section>',
    );
    const span = root.querySelector('span') as HTMLElement;
    const ctx = extractDevContext(span);
    expect(ctx).toBeDefined();
    expect(ctx?.devId).toBe('aaaaaa');
    expect(ctx?.lineNumber).toBe(10);
  });

  it('normalizes the file path to a src-relative form', () => {
    const root = buildTree(
      '<h1 data-dev-file="/Users/x/app/src/pages/home.tsx" data-dev-line="3" data-dev-id="cccccc">Hi</h1>',
    );
    const heading = root.querySelector('h1') as HTMLElement;
    expect(extractDevContext(heading)?.fileName).toBe('src/pages/home.tsx');
  });

  it('returns undefined when neither the element nor any ancestor is attributed', () => {
    const root = buildTree('<span>no attribution</span>');
    const span = root.querySelector('span') as HTMLElement;
    expect(extractDevContext(span)).toBeUndefined();
  });
});
