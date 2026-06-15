import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Static eval. Each assertion below pins one of the AC items the primer is
// responsible for driving. Negative assertions on the skill side keep the
// cached prompt skill-agnostic. If a future change drops one of these, the
// rationale gets forced into review.

const here = dirname(fileURLToPath(import.meta.url));
const agentsSrc = resolve(here, '..');

function readFile(relPath: string): string {
  return readFileSync(resolve(agentsSrc, relPath), 'utf-8');
}

const primer = readFile('prompts/develop/seo.md');
const primerLower = primer.toLowerCase();
const skill = readFile('skills/seo/skill.md');
const coreRaw = readFile('prompts/develop/core.md');
const core = coreRaw.toLowerCase();

describe('SEO generation eval (static prompt assertions)', () => {
  describe('develop primer — AC coverage', () => {
    it('AC1: title and description length budgets are explicit', () => {
      // Failure prevented: titles run long and get truncated by Google;
      // descriptions go off-spec.
      expect(primer).toContain('≤60 chars');
      expect(primer).toContain('≤160 chars');
    });

    it('AC1: title and description must be derived from business brief, not generic', () => {
      // Failure prevented: agent ships "Home" or just the brand name as title.
      expect(primerLower).toContain('business brief');
      expect(primer).toContain('not "Home"');
    });

    it('AC2: canonical, OG, and twitter:card are required', () => {
      // Failure prevented: pages ship with title + description only and skip
      // the canonical/OG/twitter set entirely.
      expect(primer).toContain('rel="canonical"');
      expect(primer).toContain('og:title');
      expect(primer).toContain('og:description');
      expect(primer).toContain('og:type');
      expect(primer).toContain('og:url');
      expect(primer).toContain('og:image');
      expect(primer).toContain('twitter:card');
      expect(primer).toContain('twitter:title');
      expect(primer).toContain('twitter:description');
      expect(primer).toContain('twitter:image');
    });

    it('AC3: JSON-LD with schema-org type is required, with minimum mandatory fields', () => {
      // Failure prevented: agent skips JSON-LD entirely. Earlier test showed
      // a generic anti-fabrication clause caused this — splitting into
      // "minimum mandatory" + "optional only with real values" is the fix.
      expect(primer).toContain('application/ld+json');
      expect(primer).toContain('@context');
      expect(primer).toContain('@type');
      expect(primerLower).toContain('at minimum populate');
      // Schema-type list anchors common archetypes
      expect(primer).toContain('Restaurant');
      expect(primer).toContain('Organization');
      expect(primer).toContain('FAQPage');
    });

    it('AC3: anti-fabrication clause is scoped to optional JSON-LD fields, not the whole block', () => {
      // The anti-fabrication clause must say "omit fields you don't have" —
      // NOT "omit JSON-LD entirely if business context is thin."
      expect(primerLower).toContain('only when the user');
      expect(primer).toContain("don't fabricate");
      expect(primerLower).toContain('omit a field');
      expect(primerLower).toContain('authoritative business identity');
    });

    it('RUBICON-343: homepage emits the WebSite/Organization/WebPage baseline @graph with dates', () => {
      // Failure prevented: agent emits a single fitting type instead of the
      // required universal baseline triad on the homepage.
      expect(primer).toContain('@graph');
      expect(primer).toContain('WebSite');
      expect(primer).toContain('WebPage');
      expect(primer).toContain('Organization');
      expect(primer).toContain('datePublished');
      expect(primer).toContain('dateModified');
      expect(primerLower).toContain('only when the brief gives a real location');
    });

    it('RUBICON-344: new pages use a page-purpose type and reference the site Organization', () => {
      // Failure prevented: sub-pages re-declare Organization or omit the
      // page-purpose type / entity reference.
      expect(primer).toContain('AboutPage');
      expect(primer).toContain('ContactPage');
      expect(primer).toContain('@id');
      expect(primerLower).toContain('rather than re-declaring');
    });

    it('AC4: image hygiene attributes are required on every img', () => {
      // Failure prevented: missing width/height (CLS), missing alt
      // (accessibility), missing fetchpriority on LCP (LCP regression).
      expect(primer).toContain('`width`');
      expect(primer).toContain('`height`');
      expect(primer).toContain('`alt`');
      expect(primer).toContain('`loading`');
      expect(primer).toContain('`fetchpriority`');
      expect(primerLower).toContain('lcp');
    });

    it('AC5: single h1 + heading hierarchy is required', () => {
      expect(primer).toContain('Exactly one `<h1>`');
      expect(primerLower).toContain('without skipping levels');
    });

    it('AC6: sitemap auto-sync from routes.tsx is documented', () => {
      // routes.tsx → seo-routes.ts auto-sync hook (added in this PR) is the
      // only way the agent satisfies AC6 without remembering to update both
      // files. Primer note prevents the agent from fighting the hook.
      expect(primer).toContain('auto-sync');
      expect(primer).toContain('seo-routes.ts');
      expect(primerLower).toContain("don't hand-edit");
    });

    it('AC7: primer does not reference the seo skill', () => {
      // AC7 wants SEO to fire during initial design preview without conflict
      // with the skill-load gate. Resolved by keeping the primer skill-
      // agnostic — primer is always in context, no skill load needed, so the
      // design-preview skill-load restriction doesn't apply.
      expect(primerLower).not.toMatch(/load the .?seo.? skill/);
      expect(primer).not.toContain('seo__audit');
    });
  });

  describe('seo skill — identity & auto-load preserved', () => {
    it('keeps the description, whenToUse, and intents identical to main', () => {
      // Skill identity/auto-load markers are unchanged; only the JSON-LD
      // schema section is intentionally synced to the triad/@id baseline
      // (asserted below). The skill is loaded on-demand during develop/SEO
      // sessions, so its schema guidance must match the always-loaded primer.
      expect(skill).toContain(
        'description: SEO analysis, optimization, and v8 implementation patterns',
      );
      expect(skill).toContain(
        'ALSO load this skill when adding a new page/route to a v8 app',
      );
      expect(skill).toContain('# SEO Analysis & Optimization Skill');
      expect(skill).toContain('Implementing SEO in the v8 Template');
    });
  });

  describe('seo skill — schema section synced to the triad/@id baseline', () => {
    it('teaches the homepage WebSite/Organization/WebPage @graph and @id entity references', () => {
      // Prevents drift from the develop primer: if the skill reverts to the old
      // single-@type-per-page pattern, the on-demand SEO/audit path would
      // contradict what the primer generates at create.
      expect(skill).toContain('@graph');
      expect(skill).toContain('WebSite');
      expect(skill).toContain('WebPage');
      expect(skill).toContain('isPartOf');
      expect(skill).toContain('rather than re-declaring them');
    });
  });

  describe('develop core — unchanged from main', () => {
    it('does not force-load the seo skill (kept clean from this PR)', () => {
      // AC7 handled via primer, not core.md, per the review constraint "don't
      // add to core.md unless solving a specific item".
      expect(core).not.toContain('seo — load before creating any new page or route');
      expect(core).not.toContain('load the `seo` skill immediately');
      expect(core).not.toContain('seo.md');
    });

    it('preserves the INITIAL SCOPE: marker rule used to detect the design-preview phase', () => {
      expect(coreRaw).toContain('the literal marker `INITIAL SCOPE:`');
      expect(coreRaw).toContain('Build ONLY the homepage design for this preview');
      expect(coreRaw).toContain('Build ONLY the main app view for this preview');
    });
  });
});
