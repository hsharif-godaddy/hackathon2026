import type { EvalResult, Evaluator } from '../evaluator.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import { readSnapshotHtml } from '../shared.js';
import { extractBodyHtml, htmlToText } from './shared.js';

const CTA_WORDS =
  /\b(book|book now|schedule|request|quote|get started|contact|call|order|sign up|subscribe)\b/i;

function hasNav(html: string): boolean {
  return (
    /<nav\b/i.test(html)
    || /role\s*=\s*["']navigation["']/i.test(html)
    || /\baria-label\s*=\s*["'][^"']*navigation[^"']*["']/i.test(html)
  );
}

function hasCTA(text: string): boolean {
  return CTA_WORDS.test(text);
}

function hasHero(bodyHtml: string, bodyText: string): boolean {
  const hasH1 = /<h1\b/i.test(bodyHtml) || /\nH1[:\s]/i.test(bodyText);
  const hasHeadline = hasH1 || /\bheadline\b/i.test(bodyText) || bodyText.length > 60;
  return hasHeadline && hasCTA(bodyText);
}

async function snapshotBody(
  snapshot?: DOMSnapshot,
): Promise<{ html: string; text: string }> {
  if (!snapshot) return { html: '', text: '' };
  const html = extractBodyHtml(await readSnapshotHtml(snapshot));
  return { html, text: htmlToText(html) };
}

async function assessStructure(snapshot?: DOMSnapshot): Promise<{
  hasSnapshot: boolean;
  hero: boolean;
  navigation: boolean;
  primaryCta: boolean;
}> {
  const { html, text } = await snapshotBody(snapshot);
  if (!html.trim()) {
    return {
      hasSnapshot: false,
      hero: false,
      navigation: false,
      primaryCta: false,
    };
  }

  return {
    hasSnapshot: true,
    hero: hasHero(html, text),
    navigation: hasNav(html),
    primaryCta: hasCTA(text),
  };
}

function passFail(
  evaluator: string,
  ok: boolean,
  reason: string,
  details?: Record<string, unknown>,
): EvalResult {
  return {
    evaluator,
    score: ok ? 1.0 : 0.0,
    verdict: ok ? 'pass' : 'fail',
    reason,
    ...(details ? { details } : {}),
  };
}

export class HeroSectionPresenceEvaluator implements Evaluator {
  readonly name = 'hero_section_presence';

  async evaluate(
    _transcript: Transcript,
    _scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const structure = await assessStructure(snapshot);
    if (!structure.hasSnapshot) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No DOM snapshot available to evaluate hero section',
      };
    }

    return passFail(
      this.name,
      structure.hero,
      structure.hero
        ? 'Hero-like section with headline + CTA detected'
        : 'No clear hero section with headline + CTA detected',
    );
  }
}

export class NavigationPresenceEvaluator implements Evaluator {
  readonly name = 'navigation_presence';

  async evaluate(
    _transcript: Transcript,
    _scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const structure = await assessStructure(snapshot);
    if (!structure.hasSnapshot) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No DOM snapshot available to evaluate navigation',
      };
    }

    return passFail(
      this.name,
      structure.navigation,
      structure.navigation ? 'Navigation detected' : 'No navigation detected',
    );
  }
}

export class PrimaryCtaPresenceEvaluator implements Evaluator {
  readonly name = 'primary_cta_presence';

  async evaluate(
    _transcript: Transcript,
    _scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const structure = await assessStructure(snapshot);
    if (!structure.hasSnapshot) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No DOM snapshot available to evaluate CTA',
      };
    }

    return passFail(
      this.name,
      structure.primaryCta,
      structure.primaryCta ? 'CTA language detected' : 'No clear primary CTA detected',
    );
  }
}

// Compatibility aggregate only. Do not register this alongside the individual
// structure evaluators; createBaselineEvaluators() registers the components.
export class MandatoryStructureComplianceEvaluator implements Evaluator {
  readonly name = 'mandatory_structure_compliance';

  async evaluate(
    _transcript: Transcript,
    _scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const structure = await assessStructure(snapshot);
    if (!structure.hasSnapshot) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'Insufficient DOM snapshot to check mandatory structure',
      };
    }

    const ok =
      structure.hero && structure.navigation && structure.primaryCta;
    return passFail(
      this.name,
      ok,
      ok ? 'Mandatory structure checks passed' : 'Mandatory structure checks failed',
      {
        hero: structure.hero ? 'pass' : 'fail',
        navigation: structure.navigation ? 'pass' : 'fail',
        primaryCta: structure.primaryCta ? 'pass' : 'fail',
      },
    );
  }
}
