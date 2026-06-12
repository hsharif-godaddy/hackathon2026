/**
 * The embedded-text constraint is appended to PagePromptAgent's generated build
 * prompt AFTER the LLM rewrite (AIROBUILD-2430). buildUserPrompt emits a per-asset
 * "do NOT overlay" note, but PagePromptAgent's summarizing rewrite drops it
 * (confirmed via hop1/hop2 logging). Appending deterministically guarantees the
 * develop agent receives it verbatim, regardless of how the rewrite LLM behaves.
 */
import { describe, expect, it } from 'vitest';

import { buildEmbeddedTextConstraint, sanitizeEmbeddedText } from '../embedded-text-constraint.js';
import type { AssetInfo } from '../../../types/rebuild.js';

function asset(over: Partial<AssetInfo>): AssetInfo {
  return {
    url: 'https://example.com/img.jpg',
    localPath: '.source-site/assets/images/img.jpg',
    type: 'image',
    sourcePages: ['https://example.com/'],
    ...over,
  };
}

describe('buildEmbeddedTextConstraint', () => {
  it('returns an empty string when no asset has embedded text', () => {
    const out = buildEmbeddedTextConstraint([
      asset({ localPath: '.source-site/assets/images/a.jpg' }),
      asset({ localPath: '.source-site/assets/images/b.jpg', hasEmbeddedText: false }),
    ]);
    expect(out).toBe('');
  });

  it('lists each embedded-text image with its public path and the baked-in text', () => {
    const out = buildEmbeddedTextConstraint([
      asset({
        localPath: '.source-site/assets/images/marquee.jpg',
        hasEmbeddedText: true,
        embeddedText: 'Bon Appetito',
      }),
    ]);
    // Servable /assets/ path, not the on-disk source-site prefix.
    expect(out).toContain('/assets/images/marquee.jpg');
    expect(out).not.toContain('.source-site/');
    expect(out).toContain('Bon Appetito');
  });

  it('carries a hard do-not-overlay instruction the rewrite cannot soften', () => {
    const out = buildEmbeddedTextConstraint([
      asset({ hasEmbeddedText: true, embeddedText: 'THE FRENCH ITALIAN TABLE' }),
    ]);
    expect(out).toContain('do NOT overlay');
  });

  it('cites each image’s scraped role so the agent reproduces it as the source did', () => {
    const out = buildEmbeddedTextConstraint([
      asset({ usageContext: 'hero', hasEmbeddedText: true, embeddedText: 'Bon Appetito' }),
    ]);
    expect(out).toContain('hero');
  });

  it('forbids substituting images or fabricating a carousel/slideshow', () => {
    const out = buildEmbeddedTextConstraint([
      asset({ usageContext: 'hero', hasEmbeddedText: true, embeddedText: 'Bon Appetito' }),
    ]);
    // The freestyle failure mode: agent routes around the no-overlay rule by
    // building a clean-image carousel and re-typing the text on top.
    expect(out.toLowerCase()).toContain('carousel');
    expect(out).toMatch(/do NOT (substitute|fabricate|invent|replace)/i);
  });

  it('skips assets flagged hasEmbeddedText but with no transcribed text', () => {
    const out = buildEmbeddedTextConstraint([
      asset({ hasEmbeddedText: true, embeddedText: '' }),
      asset({ hasEmbeddedText: true, embeddedText: null }),
    ]);
    expect(out).toBe('');
  });

  it('keeps multi-line embedded text on a single constraint line', () => {
    // Real case: a vision scan returned "COMING\nSOON". A raw newline would
    // split the constraint's single-line "- ... text" entry and blur the block.
    const out = buildEmbeddedTextConstraint([
      asset({ hasEmbeddedText: true, embeddedText: 'COMING\nSOON' }),
    ]);
    const entryLine = out.split('\n').find(l => l.includes('already contains the text'));
    expect(entryLine).toContain('COMING SOON');
    expect(out).not.toContain('COMING\nSOON');
  });

  it('does not let a quote in the transcription break the quoted entry', () => {
    const out = buildEmbeddedTextConstraint([
      asset({ hasEmbeddedText: true, embeddedText: 'Chef\'s "special"' }),
    ]);
    // No raw double-quote from the transcription survives to fight the wrapper.
    expect(out).not.toContain('"special"');
  });

  describe('sanitizeEmbeddedText', () => {
    it('collapses whitespace and newlines, strips double quotes, trims', () => {
      expect(sanitizeEmbeddedText('COMING\nSOON')).toBe('COMING SOON');
      expect(sanitizeEmbeddedText('  spaced   out  ')).toBe('spaced out');
      expect(sanitizeEmbeddedText('say "hi"')).toBe("say 'hi'");
    });
  });

  it('includes every embedded-text image when several are present', () => {
    const out = buildEmbeddedTextConstraint([
      asset({ localPath: '.source-site/assets/images/hero.jpg', hasEmbeddedText: true, embeddedText: 'Bon Appetito' }),
      asset({ localPath: '.source-site/assets/images/logo.png', hasEmbeddedText: true, embeddedText: 'THE FRENCH ITALIAN TABLE' }),
      asset({ localPath: '.source-site/assets/images/plain.jpg' }),
    ]);
    expect(out).toContain('/assets/images/hero.jpg');
    expect(out).toContain('/assets/images/logo.png');
    expect(out).not.toContain('/assets/images/plain.jpg');
  });
});
