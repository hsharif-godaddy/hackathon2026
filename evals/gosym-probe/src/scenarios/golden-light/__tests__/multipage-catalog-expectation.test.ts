import { describe, it, expect } from 'vitest';
import { multipageCatalogExpectation }
  from '../expectations/multipage-catalog.expectation.js';
import { ExpectedArtifactMatchEvaluator }
  from '../../../evaluators/expected-artifact-match.js';
import { DirectionalSignalEvaluator }
  from '../../../evaluators/directional-signal.js';
import type { Transcript } from '../../../runner/transcript.js';
import type { CapturedSite } from '../../../clients/site-capture/types.js';
import type { Scenario } from '../../types.js';
import type { Persona } from '../../../personas/types.js';

const mockPersona: Persona = { name: 'test', description: '', systemPrompt: '' };

function makeScenario(): Scenario {
  return {
    name: 'multipage-catalog',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    expectedArtifact: multipageCatalogExpectation,
  };
}

function makeTranscript(site: CapturedSite): Transcript {
  return {
    scenarioName: 'multipage-catalog',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    capturedSite: site,
    errors: [],
    captureErrors: [],
  };
}

function route(path: string) {
  return {
    path,
    url: `http://t${path}`,
    origin: path === '/' ? ('homepage' as const) : ('crawl' as const),
    status: 'ok' as const,
  };
}

function siteWith(paths: string[], body: string): CapturedSite {
  return {
    previewUrl: 'http://t',
    generatedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 0,
    outputDir: '/tmp',
    routes: paths.map(route),
    perRoute: [
      {
        route: route('/'),
        rendered: {
          title: 'Welcome',
          h1: 'Welcome',
          headingText: 'Welcome',
          bodyPreview: body,
        },
        perViewport: { mobile: { tiles: [] }, laptop: { tiles: [] } },
      },
    ],
    errors: [],
  };
}

describe('multipageCatalogExpectation fixture', () => {
  const evaluator = new ExpectedArtifactMatchEvaluator();

  it('is at evalVersion v2', () => {
    expect(multipageCatalogExpectation.evalVersion).toBe('v2');
  });

  it('passes a real multi-page catalog build', async () => {
    const site = siteWith(
      ['/', '/catalog', '/about'],
      'Browse our pottery, textiles, and woodwork collection',
    );
    const result = await evaluator.evaluate(makeTranscript(site), makeScenario());
    expect(result.verdict).toBe('pass');
  });

  it('hard-fails when the site is single-page (is-multi-page unmet)', async () => {
    const site = siteWith(['/'], 'Browse our pottery and textiles');
    const result = await evaluator.evaluate(makeTranscript(site), makeScenario());
    expect(result.verdict).toBe('fail');
    expect(result.details?.hardFailures).toContain('is-multi-page');
  });

  it('binary verdict still passes when only catalog copy (directional) is missing', async () => {
    const site = siteWith(['/', '/about'], 'Welcome to our company homepage');
    const result = await evaluator.evaluate(makeTranscript(site), makeScenario());
    // 'mentions-catalog' is now a directional signal, not a binary item, so
    // its absence no longer downgrades the binary artifact-match verdict.
    expect(result.verdict).toBe('pass');
  });

  it('directional evaluator reports the unmet catalog signal as score 0 (directional)', async () => {
    const directional = new DirectionalSignalEvaluator();
    const site = siteWith(['/', '/about'], 'Welcome to our company homepage');
    const result = await directional.evaluate(makeTranscript(site), makeScenario());
    expect(result.verdict).toBe('directional');
    expect(result.score).toBe(0);
    expect(result.details?.metCount).toBe(0);
  });

  it('directional evaluator scores 1 when catalog copy is present', async () => {
    const directional = new DirectionalSignalEvaluator();
    const site = siteWith(['/', '/shop'], 'Browse our pottery and textiles catalog');
    const result = await directional.evaluate(makeTranscript(site), makeScenario());
    expect(result.verdict).toBe('directional');
    expect(result.score).toBe(1);
  });
});
