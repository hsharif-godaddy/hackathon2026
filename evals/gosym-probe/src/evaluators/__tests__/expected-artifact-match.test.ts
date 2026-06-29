import { describe, it, expect } from 'vitest';
import { ExpectedArtifactMatchEvaluator } from '../expected-artifact-match.js';
import {
  makeScenario,
  makeTranscriptWith as makeTranscript,
} from './evaluator-test-helpers.js';
import type { CapturedSite } from '../../clients/site-capture/types.js';
import type {
  ChecklistItem,
  ExpectedArtifactSpec,
} from '../../scenarios/types.js';

function makeSite(overrides: Partial<CapturedSite> = {}): CapturedSite {
  return {
    previewUrl: 'http://test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 0,
    outputDir: '/tmp',
    routes: [
      {
        path: '/',
        url: 'http://test/',
        origin: 'homepage',
        status: 'ok',
      },
    ],
    perRoute: [],
    errors: [],
    ...overrides,
  };
}

function makeSpec(
  items: ChecklistItem[],
  overrides: Partial<ExpectedArtifactSpec> = {},
): ExpectedArtifactSpec {
  return { intent: 'do the thing', items, evalVersion: 'v1', ...overrides };
}

const contactRouteItem: ChecklistItem = {
  id: 'has-contact-route',
  description: 'a contact route is reachable',
  type: 'capability',
  routeMatcher: { path: '/contact', mustBeReachable: true },
};

describe('ExpectedArtifactMatchEvaluator', () => {
  const evaluator = new ExpectedArtifactMatchEvaluator();

  it('has the kebab-case evaluator name', () => {
    expect(evaluator.name).toBe('expected-artifact-match');
  });

  it('returns unknown when no expected artifact is defined', async () => {
    const result = await evaluator.evaluate(makeTranscript(), makeScenario());
    expect(result.verdict).toBe('unknown');
  });

  it('passes when all capability items are met', async () => {
    const site = makeSite({
      routes: [
        { path: '/', url: 'http://t/', origin: 'homepage', status: 'ok' },
        {
          path: '/contact',
          url: 'http://t/contact',
          origin: 'crawl',
          status: 'ok',
        },
      ],
    });
    const result = await evaluator.evaluate(
      makeTranscript({ capturedSite: site }),
      makeScenario({ expectedArtifact: makeSpec([contactRouteItem]) }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
    expect(result.evalVersion).toBe('v1');
  });

  it('fails when a capability item is unmet', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ capturedSite: makeSite() }),
      makeScenario({ expectedArtifact: makeSpec([contactRouteItem]) }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.hardFailures).toEqual(['has-contact-route']);
  });

  it('fails when an invariance item is violated', async () => {
    const noErrorsInvariant: ChecklistItem = {
      id: 'no-module-not-found',
      description: 'transcript has no module-not-found error',
      type: 'invariance',
      textMatcher: { source: 'transcript', pattern: /^(?!.*module not found)/i },
    };
    const result = await evaluator.evaluate(
      makeTranscript({
        turns: [
          {
            role: 'assistant',
            content: 'Error: Module not found: ./x',
            toolCalls: [],
            timestamp: 0,
          },
        ],
      }),
      makeScenario({ expectedArtifact: makeSpec([noErrorsInvariant]) }),
    );
    expect(result.verdict).toBe('fail');
  });

  it('downgrades to partial when only a directional item is unmet', async () => {
    const directionalItem: ChecklistItem = {
      id: 'mentions-fast',
      description: 'rendered copy mentions speed',
      type: 'directional',
      textMatcher: { source: 'rendered', pattern: /fast/i },
    };
    const site = makeSite({
      perRoute: [
        {
          route: {
            path: '/',
            url: 'http://t/',
            origin: 'homepage',
            status: 'ok',
          },
          rendered: {
            title: 'Home',
            h1: 'Welcome',
            headingText: 'Welcome',
            bodyPreview: 'a quality site',
          },
          perViewport: {
            mobile: { tiles: [] },
            laptop: { tiles: [] },
          },
        },
      ],
    });
    const result = await evaluator.evaluate(
      makeTranscript({ capturedSite: site }),
      makeScenario({ expectedArtifact: makeSpec([directionalItem]) }),
    );
    expect(result.verdict).toBe('partial');
    expect(result.details?.directionalFailures).toEqual(['mentions-fast']);
  });

  it('counts an item as unknown (not fail) when its input is absent', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({ expectedArtifact: makeSpec([contactRouteItem]) }),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.details?.unknownCount).toBe(1);
  });

  it('passes on tool-based capability via toolMatcher', async () => {
    const toolItem: ChecklistItem = {
      id: 'used-payments-skill',
      description: 'invoked the payments skill tool',
      type: 'capability',
      toolMatcher: (calls) => calls.some((c) => c.name === 'skill__payments'),
    };
    const result = await evaluator.evaluate(
      makeTranscript({
        turns: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 't1',
                name: 'skill__payments',
                startTime: 0,
                endTime: 1,
              },
            ],
            timestamp: 0,
          },
        ],
      }),
      makeScenario({ expectedArtifact: makeSpec([toolItem]) }),
    );
    expect(result.verdict).toBe('pass');
  });

  it('evaluates mixed items: pass capability + fail directional → partial', async () => {
    const directionalFail: ChecklistItem = {
      id: 'mentions-discount',
      description: 'copy mentions a discount',
      type: 'directional',
      textMatcher: { source: 'transcript', pattern: /discount/i },
    };
    const result = await evaluator.evaluate(
      makeTranscript({
        capturedSite: makeSite({
          routes: [
            { path: '/', url: 'http://t/', origin: 'homepage', status: 'ok' },
            {
              path: '/contact',
              url: 'http://t/contact',
              origin: 'crawl',
              status: 'ok',
            },
          ],
        }),
      }),
      makeScenario({
        expectedArtifact: makeSpec([contactRouteItem, directionalFail]),
      }),
    );
    expect(result.verdict).toBe('partial');
    expect(result.details?.passedCount).toBe(1);
  });
});
