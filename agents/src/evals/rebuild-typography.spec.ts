/**
 * Static eval (AIROBUILD-2651 / AIROBUILD-2587 P5): rebuild typography fidelity
 * contract — orchestrator binding, page-prompt guidance, and develop prompt gates.
 *
 * Documents the maxinedubois.com Atlas capture case (generic Serif / Sans-serif
 * categories → themed Google Font substitution). Exact source font names depend on
 * AIROBUILD-2588; this eval asserts we never silently fall back to system serifs.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { GoogleFontEntry } from '@airo/shared/fonts';

import { buildUserPrompt } from '../agents/page-prompt/user-prompt-builder.js';
import {
  findCatalogFont,
  shouldApplyRebuildTypography,
} from '../services/rebuild/typography.js';
import type {
  AssetManifest,
  PageContent,
  SiteMetadata,
  StylePreferences,
} from '../types/rebuild.js';

const here = dirname(fileURLToPath(import.meta.url));
const agentsSrc = resolve(here, '..');

function readPrompt(relPath: string): string {
  return readFileSync(resolve(agentsSrc, relPath), 'utf-8');
}

const sampleCatalog: GoogleFontEntry[] = [
  { family: 'Cormorant Garamond', category: 'serif', weights: ['400', '600', '700'], tags: [] },
  { family: 'Lora', category: 'serif', weights: ['400', '500', '600', '700'], tags: [] },
  { family: 'Inter', category: 'sans-serif', weights: ['400', '500', '600', '700'], tags: [] },
  { family: 'Georgia', category: 'serif', weights: ['400', '700'], tags: [] },
];

const keepOriginalPrefs: StylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
};

const basePageContent: PageContent = {
  url: 'https://www.maxinedubois.com/',
  slug: 'homepage',
  title: 'Home',
  content: '<h1>Welcome</h1>',
  sanitizedContent: '<h1>Welcome</h1>',
  structure: { hasHeader: true, hasFooter: true, hasSidebar: false, sections: [], navigation: [] },
  metadata: { title: 'Home' },
  scrapedAt: '2024-01-01T00:00:00Z',
};

const emptyAssetManifest: AssetManifest = {
  assets: [],
  totalAssets: 0,
  byType: { image: 0, font: 0, icon: 0, other: 0 },
  generatedAt: '2024-01-01T00:00:00Z',
};

/** Atlas often captures generic categories for Typekit / Adobe fonts (maxinedubois.com). */
const maxineduboisMetadata: SiteMetadata = {
  sourceUrl: 'https://www.maxinedubois.com',
  sitePurpose: 'Portfolio',
  targetAudience: 'Clients',
  brandVoice: 'Elegant',
  designStyle: 'Editorial',
  colorPalette: { primary: ['#000'], secondary: [], accent: [] },
  typography: { headingFonts: ['Serif'], bodyFonts: ['Sans-serif'] },
  scrapedAt: '2024-01-01T00:00:00Z',
  version: '1',
};

/** Ideal path when Atlas resolves exact Google Font families. */
const exactGoogleFontsMetadata: SiteMetadata = {
  ...maxineduboisMetadata,
  typography: {
    headingFonts: ['Cormorant Garamond'],
    bodyFonts: ['Lora'],
    scale: [],
  },
};

function buildKeepOriginalPrompt(siteMetadata: SiteMetadata, isFirstPage: boolean): string {
  return buildUserPrompt({
    siteMetadata,
    pageContent: basePageContent,
    stylePreferences: keepOriginalPrefs,
    assetManifest: emptyAssetManifest,
    isFirstPage,
    hasScreenshot: false,
  });
}

describe('rebuild typography fidelity eval (AIROBUILD-2651)', function rebuildTypographyEval() {
  describe('orchestrator — font resolution contract', function orchestratorContract() {
    it('applies typography only on first-page keep-original rebuilds', function shouldApply() {
      expect(
        shouldApplyRebuildTypography(true, keepOriginalPrefs, maxineduboisMetadata.typography),
      ).toBe(true);
      expect(
        shouldApplyRebuildTypography(false, keepOriginalPrefs, maxineduboisMetadata.typography),
      ).toBe(false);
      expect(
        shouldApplyRebuildTypography(true, { ...keepOriginalPrefs, typographyStyle: 'modern' }, maxineduboisMetadata.typography),
      ).toBe(false);
    });

    it('maxinedubois Atlas generics substitute to themed Google Fonts, not Georgia', function maxineduboisSubstitution() {
      const heading = findCatalogFont('Serif', sampleCatalog);
      const body = findCatalogFont('Sans-serif', sampleCatalog);

      expect(heading.substituted).toBe(true);
      expect(heading.entry.family).toBe('Lora');
      expect(heading.entry.family).not.toBe('Georgia');

      expect(body.substituted).toBe(true);
      expect(body.entry.family).toBe('Inter');
    });

    it('exact Google Font names resolve without substitution (parent AC ideal path)', function exactNames() {
      const heading = findCatalogFont('Cormorant Garamond', sampleCatalog);
      const body = findCatalogFont('Lora', sampleCatalog);

      expect(heading.substituted).toBe(false);
      expect(heading.entry.family).toBe('Cormorant Garamond');
      expect(body.substituted).toBe(false);
      expect(body.entry.family).toBe('Lora');
    });
  });

  describe('rebuild page prompt — keep-original typography contract', function pagePromptContract() {
    const maxineduboisPrompt = buildKeepOriginalPrompt(maxineduboisMetadata, true);
    const innerPagePrompt = buildKeepOriginalPrompt(maxineduboisMetadata, false);

    it('surfaces detected source fonts in site metadata', function metadataFonts() {
      expect(maxineduboisPrompt).toContain('Headings: Serif');
      expect(maxineduboisPrompt).toContain('Body: Sans-serif');
    });

    it('instructs develop to use pre-applied CSS variables, not fontTheme', function preAppliedGuidance() {
      expect(maxineduboisPrompt).toContain('TYPOGRAPHY DIRECTION');
      expect(maxineduboisPrompt).toContain('already applied to globals.css');
      expect(maxineduboisPrompt).toContain('var(--font-heading)');
      expect(maxineduboisPrompt).toContain('var(--font-sans)');
      expect(maxineduboisPrompt).toContain('do NOT call fontTheme, import Google Fonts, or hardcode fontFamily');
    });

    it('uses the same pre-applied guidance on inner rebuild pages', function innerPageGuidance() {
      expect(innerPagePrompt).toContain('already applied to globals.css');
      expect(innerPagePrompt).toContain('do NOT call fontTheme');
    });

    it('documents exact fonts when Atlas captures Google Font families', function exactFontPrompt() {
      const prompt = buildKeepOriginalPrompt(exactGoogleFontsMetadata, true);
      expect(prompt).toContain('Cormorant Garamond');
      expect(prompt).toContain('Lora');
    });
  });

  describe('develop prompts — rebuild vs non-rebuild font paths', function developPromptContract() {
    const core = readPrompt('prompts/develop/core.md');
    const fontTheme = readPrompt('prompts/develop/font-theme.md');

    it('core rebuild workflow forbids fontTheme and inline fontFamily hardcodes', function coreRebuild() {
      expect(core).toContain('Typography is pre-applied');
      expect(core).toContain('--font-heading');
      expect(core).toContain('--font-sans');
      expect(core).toMatch(/do \*\*not\*\* call `fontTheme` during rebuild/i);
      expect(core).toMatch(/do \*\*not\*\* hardcode `fontFamily`/i);
    });

    it('font-theme tool doc gates all modes during website rebuild', function fontThemeRebuildGate() {
      expect(fontTheme).toContain('Website rebuild flow');
      expect(fontTheme).toMatch(/do \*\*not\*\* call `fontTheme`/i);
      expect(fontTheme).toContain('var(--font-heading)');
    });

    it('font-theme tool doc still documents suggest/apply for non-rebuild develop', function fontThemeNonRebuild() {
      expect(fontTheme).toContain("mode: 'suggest'");
      expect(fontTheme).toContain("mode: 'apply'");
      expect(fontTheme).toContain('User asks for options');
    });
  });
});
