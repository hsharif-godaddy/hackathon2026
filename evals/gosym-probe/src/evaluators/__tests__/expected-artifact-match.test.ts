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
    expect(result.verdict).toBe('incomplete');
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

  it('counts an item as unknown (not fail) when its input is absent', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({ expectedArtifact: makeSpec([contactRouteItem]) }),
    );
    expect(result.verdict).toBe('incomplete');
    expect(result.details?.incompleteCount).toBe(1);
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

  it('ignores directionalItems entirely (they are scored by DirectionalSignalEvaluator)', async () => {
    const spec = {
      ...makeSpec([contactRouteItem]),
      directionalItems: [
        {
          id: 'mentions-discount',
          description: 'copy mentions a discount',
          textMatcher: { source: 'transcript' as const, pattern: /discount/i },
        },
      ],
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
      makeScenario({ expectedArtifact: spec }),
    );
    // Only the binary contactRouteItem is scored; the unmet directional item
    // neither fails nor downgrades the verdict.
    expect(result.verdict).toBe('pass');
    expect(result.details?.passedCount).toBe(1);
  });
});
