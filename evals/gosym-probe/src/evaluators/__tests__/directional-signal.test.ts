import { describe, it, expect } from 'vitest';
import { DirectionalSignalEvaluator } from '../directional-signal.js';
import {
  makeScenario,
  makeTranscriptWith as makeTranscript,
} from './evaluator-test-helpers.js';
import type { ExpectedArtifactSpec } from '../../scenarios/types.js';
import type { CapturedSite } from '../../clients/site-capture/types.js';

function siteWith(bodyPreview: string): CapturedSite {
  return {
    routes: [{ path: '/', url: 'http://t/', origin: 'homepage', status: 'ok' }],
    perRoute: [
      {
        route: { path: '/', url: 'http://t/', origin: 'homepage', status: 'ok' },
        rendered: { title: 'T', h1: 'H', headingText: 'H', bodyPreview },
        perViewport: { mobile: { tiles: [] }, laptop: { tiles: [] } },
      },
    ],
  } as unknown as CapturedSite;
}

function specWithDirectional(
  ...ids: Array<{ id: string; pattern: RegExp }>
): ExpectedArtifactSpec {
  return {
    intent: 'build a site',
    items: [],
    directionalItems: ids.map((d) => ({
      id: d.id,
      description: `mentions ${d.id}`,
      textMatcher: { source: 'rendered', pattern: d.pattern },
    })),
    evalVersion: 'v1',
  };
}

describe('DirectionalSignalEvaluator', () => {
  const evaluator = new DirectionalSignalEvaluator();

  it('is a score-mode, higher-is-better evaluator', () => {
    expect(evaluator.name).toBe('directional-signal');
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(false);
  });

  it('returns incomplete when the scenario has no directional items', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ capturedSite: siteWith('anything') }),
      makeScenario({ expectedArtifact: { intent: 'x', items: [], evalVersion: 'v1' } }),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('scores the fraction of directional signals met as directional', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ capturedSite: siteWith('fast and cheap') }),
      makeScenario({
        expectedArtifact: specWithDirectional(
          { id: 'fast', pattern: /fast/i },
          { id: 'cheap', pattern: /cheap/i },
          { id: 'green', pattern: /green/i },
        ),
      }),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(2 / 3);
    expect(result.details?.metCount).toBe(2);
    expect(result.details?.evaluatedCount).toBe(3);
  });

  it('scores 1.0 when all directional signals are met', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ capturedSite: siteWith('fast and cheap') }),
      makeScenario({
        expectedArtifact: specWithDirectional(
          { id: 'fast', pattern: /fast/i },
          { id: 'cheap', pattern: /cheap/i },
        ),
      }),
    );
    expect(result.score).toBe(1);
  });

  it('scores 0.0 when no directional signal is met (never a fail verdict)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ capturedSite: siteWith('plain copy') }),
      makeScenario({
        expectedArtifact: specWithDirectional({ id: 'fast', pattern: /fast/i }),
      }),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBe(0);
  });

  it('mixed evaluable/unevaluable: unevaluable item excluded from denominator', async () => {
    // 'fast' uses a transcript-source matcher (always evaluable, met);
    // 'has-widget' uses a rendered textMatcher but the site is ABSENT, so it is
    // unevaluable and must be excluded — score is 1/1, not 1/2.
    const spec: ExpectedArtifactSpec = {
      intent: 'build a site',
      items: [],
      directionalItems: [
        {
          id: 'fast',
          description: 'transcript mentions fast',
          textMatcher: { source: 'transcript', pattern: /fast/i },
        },
        {
          id: 'has-widget',
          description: 'rendered copy mentions widget (needs capture)',
          textMatcher: { source: 'rendered', pattern: /widget/i },
        },
      ],
      evalVersion: 'v1',
    };
    const result = await evaluator.evaluate(
      makeTranscript({
        turns: [
          { role: 'assistant', content: 'made it fast', toolCalls: [], timestamp: 0 },
        ],
        // no capturedSite → the rendered matcher is unevaluable
      }),
      makeScenario({ expectedArtifact: spec }),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBe(1);
    expect(result.details?.evaluatedCount).toBe(1);
    expect(result.details?.incompleteCount).toBe(1);
  });

  it('excludes unevaluable items from the denominator (missing capture → incomplete)', async () => {
    // No capturedSite: a rendered textMatcher cannot be evaluated.
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        expectedArtifact: specWithDirectional({ id: 'fast', pattern: /fast/i }),
      }),
    );
    // The only item is unevaluable → nothing to score → unknown, not a 0 fail.
    expect(result.verdict).toBe('incomplete');
    expect(result.details?.incompleteCount).toBe(1);
  });
});
