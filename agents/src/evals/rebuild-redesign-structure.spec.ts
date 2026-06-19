/**
 * Static eval (AIROBUILD-2682): a redesign rebuild must actually depart from the
 * source's structure, and the customer's free-text design intent must reach the
 * page prompt — not just the inferred enum.
 *
 * Guards the three compounding losses the ticket fixed:
 *   1. free-text intent → bare enum: the Initial Agent prompt + tool expose
 *      designIntent, and buildUserPrompt injects it verbatim.
 *   2. redesign directive silent on structure: the redesign design block grants
 *      structure-axis freedom; design-redesign.md no longer mis-frames itself as
 *      "Let Airo Decide" and tells the model to restructure.
 *   3. full skeleton injected regardless: redesign mode reframes the verbatim
 *      content dump as content-only, not a layout blueprint.
 *
 * Mirrors rebuild-asset-instruction.spec.ts: static, unit-level assertions over
 * the built prompt + prompt source files (no LLM, no provider keys). If a future
 * edit strips one of these, the redesign silently regresses to cloning — this
 * eval fails before that lands. The behavioral counterpart (a real reimagine
 * trace departs in structure) is verified manually via E2E / Langfuse.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildUserPrompt } from '../agents/page-prompt/user-prompt-builder.js';
import type { AssetManifest, PageContent, SiteMetadata, StylePreferences } from '../types/rebuild.js';

const here = dirname(fileURLToPath(import.meta.url));
const agentsSrc = resolve(here, '..');

function readSrc(relPath: string): string {
  return readFileSync(resolve(agentsSrc, relPath), 'utf-8');
}

const siteMetadata: SiteMetadata = {
  sourceUrl: 'https://example.com',
  sitePurpose: 'Bakery',
  targetAudience: 'Local customers',
  brandVoice: 'Warm',
  designStyle: 'Cozy',
  colorPalette: { primary: ['#000'], secondary: [], accent: [] },
  typography: { headingFonts: ['Inter'], bodyFonts: ['Inter'], scale: [] },
  scrapedAt: '2024-01-01T00:00:00Z',
  version: '1',
};

const pageContent: PageContent = {
  url: 'https://example.com/',
  slug: 'homepage',
  title: 'Home',
  content: '<h1>Welcome</h1>',
  sanitizedContent: '<h1>Welcome</h1><p>We bake fresh bread daily.</p>',
  structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
  metadata: { title: 'Home' },
  scrapedAt: '2024-01-01T00:00:00Z',
};

const assetManifest: AssetManifest = {
  assets: [],
  totalAssets: 0,
  byType: { image: 0, font: 0, icon: 0, other: 0 },
  generatedAt: '2024-01-01T00:00:00Z',
};

function builtPrompt(stylePreferences: Partial<StylePreferences>): string {
  return buildUserPrompt({
    siteMetadata,
    pageContent,
    stylePreferences: {
      designDirection: 'modernize',
      colorPreference: 'keep-original',
      typographyStyle: 'keep-original',
      layoutApproach: 'responsive',
      ...stylePreferences,
    },
    assetManifest,
    isFirstPage: true,
    hasScreenshot: false,
  });
}

describe('rebuild redesign-structure eval (static prompt assertions)', () => {
  describe('redesign directive grants structure-axis freedom (cause 2)', () => {
    for (const designDirection of ['modernize', 'simplify', 'bold'] as const) {
      it(`${designDirection} prompt permits departing from the source structure`, () => {
        const prompt = builtPrompt({ designDirection });
        expect(prompt).toMatch(/not bound to|reorganize|restructure/i);
        expect(prompt).toMatch(/REDESIGN, not a clone/i);
      });
    }

    it('keep-similar still gets the faithful-clone framing and NOT the structural-freedom preamble', () => {
      const prompt = builtPrompt({ designDirection: 'keep-similar' });
      expect(prompt).toMatch(/ONLY the sections that exist|reproduce/i);
      expect(prompt).not.toMatch(/REDESIGN, not a clone/i);
    });
  });

  describe("customer's free-text design intent reaches the prompt (cause 1)", () => {
    it('injects the designIntent verbatim as a high-priority block', () => {
      const prompt = builtPrompt({ designIntent: 'Ignore the existing layout and reimagine from first principles.' });
      expect(prompt).toContain("CUSTOMER'S DESIGN INSTRUCTION");
      expect(prompt).toContain('Ignore the existing layout and reimagine from first principles.');
    });

    it('omits the instruction block when no intent was supplied (enum-only path unchanged)', () => {
      expect(builtPrompt({})).not.toContain("CUSTOMER'S DESIGN INSTRUCTION");
    });
  });

  describe('scraped skeleton stops anchoring the redesign (cause 3)', () => {
    it('reframes the full content dump as content-only in redesign mode', () => {
      expect(builtPrompt({ designDirection: 'modernize' })).toMatch(/NOT a layout blueprint|do not mirror the section order/i);
    });

    it('keeps the plain content framing for keep-similar (clone unchanged)', () => {
      const prompt = builtPrompt({ designDirection: 'keep-similar' });
      expect(prompt).toContain('FULL PAGE CONTENT (reference for context)');
      expect(prompt).not.toMatch(/NOT a layout blueprint/i);
    });
  });

  describe('design-redesign.md system fragment (cause 2, criterion #4)', () => {
    const designRedesign = readSrc('prompts/page-prompt/design-redesign.md');

    it('no longer triggers off "Let Airo Decide"', () => {
      expect(designRedesign).not.toMatch(/Let Airo Decide/i);
    });

    it('instructs the model to restructure, not reproduce', () => {
      expect(designRedesign).toMatch(/restructure freely|reorganize the information architecture|do not mirror the source/i);
    });
  });

  describe('agent + tool surfaces expose designIntent (cause 1)', () => {
    const rebuildIntent = readSrc('prompts/initial/3.0/rebuild-intent.md');
    const websiteRebuildSource = readSrc('tools/ai-lib-tools/website-rebuild.ts');

    it('the Initial Agent prompt tells the agent to capture the free-text designIntent', () => {
      expect(rebuildIntent).toContain('designIntent');
      // Anchor on the dedicated section heading, not a loose keyword that a
      // pre-existing unrelated line could satisfy.
      expect(rebuildIntent).toContain('Design intent (free-text)');
      expect(rebuildIntent).toMatch(/close to \*\*verbatim\*\*|their own words/i);
    });

    it('the websiteRebuild tool schema exposes designIntent', () => {
      expect(websiteRebuildSource).toContain('designIntent: z');
    });
  });
});
