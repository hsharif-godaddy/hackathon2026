import { describe, expect, it } from 'vitest';

import { selectSystemPromptFiles } from '../../page-prompt-agent.js';

// Guards the fix for AIROBUILD-2241: the redesign brief (design-redesign.md)
// instructs the model to add bento grids, differentiation flourishes, and
// "social proof" sections — which fabricated sections the source never had on
// a faithful clone. design-preserve.md must load instead whenever the design
// is being preserved (keep-similar), and the redesign brief must only load on
// an explicit non-preserve direction.
describe('selectSystemPromptFiles — design fragment gating', () => {
  it('loads design-preserve.md (not design-redesign.md) when preserving on the homepage', () => {
    const files = selectSystemPromptFiles({ isFirstPage: true, useAtlasCrawler: true, preserveDesign: true });
    expect(files).toContain('design-preserve.md');
    expect(files).not.toContain('design-redesign.md');
  });

  it('loads design-redesign.md (not design-preserve.md) when NOT preserving on the homepage', () => {
    const files = selectSystemPromptFiles({ isFirstPage: true, useAtlasCrawler: true, preserveDesign: false });
    expect(files).toContain('design-redesign.md');
    expect(files).not.toContain('design-preserve.md');
  });

  it('loads neither design fragment on inner pages, regardless of preserveDesign', () => {
    for (const preserveDesign of [true, false]) {
      const files = selectSystemPromptFiles({ isFirstPage: false, useAtlasCrawler: true, preserveDesign });
      expect(files).not.toContain('design-preserve.md');
      expect(files).not.toContain('design-redesign.md');
    }
  });

  it('always loads visual-reference.md on the homepage (screenshot layout fidelity)', () => {
    const files = selectSystemPromptFiles({ isFirstPage: true, useAtlasCrawler: false, preserveDesign: true });
    expect(files).toContain('visual-reference.md');
  });

  it('omits visual-reference.md on inner pages (no screenshot attached)', () => {
    const files = selectSystemPromptFiles({ isFirstPage: false, useAtlasCrawler: false, preserveDesign: true });
    expect(files).not.toContain('visual-reference.md');
  });

  it('loads the Atlas preserve-* fragments independently of preserveDesign', () => {
    // The crawler fragments are gated on useAtlasCrawler; the design fragment on
    // preserveDesign. They must not interfere — a redesign rebuild over an Atlas
    // crawl still preserves detected forms/patterns.
    const files = selectSystemPromptFiles({ isFirstPage: true, useAtlasCrawler: true, preserveDesign: false });
    expect(files).toContain('preserve-interactive-patterns.md');
    expect(files).toContain('preserve-forms.md');
    expect(files).toContain('design-redesign.md');
  });
});
