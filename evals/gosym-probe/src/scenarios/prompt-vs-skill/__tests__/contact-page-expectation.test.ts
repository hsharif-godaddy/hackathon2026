import { describe, it, expect } from 'vitest';
import { contactPageExpectation } from '../expectations/contact-page.expectation.js';
import { DirectionalSignalEvaluator }
  from '../../../evaluators/directional-signal.js';
import { ExpectedArtifactMatchEvaluator }
  from '../../../evaluators/expected-artifact-match.js';
import type { DOMSnapshot, Transcript } from '../../../runner/transcript.js';
import type { CapturedSite } from '../../../clients/site-capture/types.js';
import type { Scenario } from '../../types.js';
import type { Persona } from '../../../personas/types.js';

const mockPersona: Persona = { name: 'test', description: '', systemPrompt: '' };

function makeScenario(): Scenario {
  return {
    name: 'pvs-contact-page-expectations',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    expectedArtifact: contactPageExpectation,
  };
}

function makeTranscript(
  site: CapturedSite,
  snapshots: DOMSnapshot[] = [],
): Transcript {
  return {
    scenarioName: 'pvs-contact-page-expectations',
    trialIndex: 0,
    turns: [],
    snapshots,
    capturedSite: site,
    errors: [],
    captureErrors: [],
  };
}

function snapshotWithHtml(html: string): DOMSnapshot {
  return {
    url: 'http://t/',
    screenshotPath: '/tmp/s.png',
    htmlPath: '/tmp/s.html',
    timestamp: '2026-01-01T00:00:00.000Z',
    consoleLogs: [],
    html,
  };
}

const EMPTY_RENDERED = {
  title: '',
  h1: null,
  headingText: '',
  bodyPreview: '',
};

function homeRoute(overrides = {}) {
  return { path: '/', url: 'http://t/', origin: 'homepage' as const, status: 'ok' as const, ...overrides };
}

function siteWith(opts: {
  routes?: CapturedSite['routes'];
  rendered?: Partial<CapturedSite['perRoute'][number]['rendered']>;
}): CapturedSite {
  const routes = opts.routes ?? [homeRoute()];
  return {
    previewUrl: 'http://t',
    generatedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 0,
    outputDir: '/tmp',
    routes,
    perRoute: [
      {
        route: homeRoute(),
        rendered: {
          title: 'Acme',
          h1: 'Welcome to Acme',
          headingText: 'Welcome to Acme Plumbing',
          bodyPreview: 'We fix pipes fast and reliably for your home',
          ...opts.rendered,
        },
        perViewport: { mobile: { tiles: [] }, laptop: { tiles: [] } },
      },
    ],
    errors: [],
  };
}

describe('contactPageExpectation fixture (capability matchers)', () => {
  const evaluator = new ExpectedArtifactMatchEvaluator();

  it('is at evalVersion v4', () => {
    expect(contactPageExpectation.evalVersion).toBe('v4');
  });

  it('passes has-rendered-content via snapshot HTML when rendered signals are empty', async () => {
    // Regression for run 29874099: RenderedSignals came back empty on a
    // fully-rendered page; the snapshot-HTML fallback should still see it.
    const site = siteWith({
      routes: [
        homeRoute(),
        { path: '/contact', url: 'http://t/contact', origin: 'crawl', status: 'ok' },
      ],
      rendered: EMPTY_RENDERED,
    });
    const html = '<html><body><h1>Sunny Paws Pet Grooming</h1>'
      + '<p>Your pet deserves to shine. Expert grooming services.</p></body></html>';
    const result = await evaluator.evaluate(
      makeTranscript(site, [snapshotWithHtml(html)]),
      makeScenario(),
    );
    expect(result.verdict).toBe('pass');
    const item = (result.details?.items as Array<{ id: string; status: string }>)
      .find((i) => i.id === 'has-rendered-content');
    expect(item?.status).toBe('pass');
  });

  it('fails has-rendered-content when rendered signals AND snapshot HTML are blank', async () => {
    const site = siteWith({
      routes: [
        homeRoute(),
        { path: '/contact', url: 'http://t/contact', origin: 'crawl', status: 'ok' },
      ],
      rendered: EMPTY_RENDERED,
    });
    const result = await evaluator.evaluate(
      makeTranscript(site, [snapshotWithHtml('<html><body></body></html>')]),
      makeScenario(),
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.hardFailures).toContain('has-rendered-content');
  });

  it('passes mentions-contact when a /contact route is reachable', async () => {
    const site = siteWith({
      routes: [
        homeRoute(),
        { path: '/contact', url: 'http://t/contact', origin: 'crawl', status: 'ok' },
      ],
      // No contact words in home copy — route alone should satisfy it.
      rendered: { bodyPreview: 'We fix pipes fast and reliably' },
    });
    const result = await evaluator.evaluate(makeTranscript(site), makeScenario());
    expect(result.verdict).toBe('pass');
    expect(result.evalVersion).toBe('v4');
  });

  it('passes mentions-contact via rendered copy when no contact route exists', async () => {
    const site = siteWith({
      rendered: { bodyPreview: 'Reach us anytime — email the team to get in touch' },
    });
    const result = await evaluator.evaluate(makeTranscript(site), makeScenario());
    expect(result.verdict).toBe('pass');
  });

  it('binary verdict passes when only the contact (directional) signal is absent', async () => {
    const site = siteWith({
      rendered: {
        title: 'Acme',
        h1: 'Welcome',
        headingText: 'Welcome',
        bodyPreview: 'We fix pipes fast and reliably for your home',
      },
    });
    const result = await evaluator.evaluate(makeTranscript(site), makeScenario());
    // 'mentions-contact' is a directional signal now, scored separately;
    // capability + invariance still pass, so the binary verdict is 'pass'.
    expect(result.verdict).toBe('pass');
  });

  it('directional evaluator reports the absent contact signal as score 0 (directional)', async () => {
    const directional = new DirectionalSignalEvaluator();
    const site = siteWith({
      rendered: {
        title: 'Acme',
        h1: 'Welcome',
        headingText: 'Welcome',
        bodyPreview: 'We fix pipes fast and reliably for your home',
      },
    });
    const result = await directional.evaluate(makeTranscript(site), makeScenario());
    expect(result.verdict).toBe('directional');
    expect(result.score).toBe(0);
  });
});
