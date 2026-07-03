import { describe, it, expect } from 'vitest';
import { publishFlowExpectation }
  from '../expectations/publish-flow.expectation.js';
import { ExpectedArtifactMatchEvaluator }
  from '../../../evaluators/expected-artifact-match.js';
import { DirectionalSignalEvaluator }
  from '../../../evaluators/directional-signal.js';
import type { Transcript, Turn } from '../../../runner/transcript.js';
import type { CapturedSite } from '../../../clients/site-capture/types.js';
import type { Scenario } from '../../types.js';
import type { Persona } from '../../../personas/types.js';

const mockPersona: Persona = { name: 'test', description: '', systemPrompt: '' };

function makeScenario(): Scenario {
  return {
    name: 'pvs-multi-turn-publish-flow',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    expectedArtifact: publishFlowExpectation,
  };
}

function publishTurn(): Turn {
  return {
    role: 'assistant',
    content: 'Publishing your site to production now.',
    toolCalls: [
      { id: 'p1', name: 'publishing__publish', startTime: 0, endTime: 1 },
    ],
    timestamp: 0,
  };
}

function makeTranscript(turns: Turn[]): Transcript {
  return {
    scenarioName: 'pvs-multi-turn-publish-flow',
    trialIndex: 0,
    turns,
    snapshots: [],
    capturedSite: {
      previewUrl: 'http://t',
      generatedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 0,
      outputDir: '/tmp',
      routes: [{ path: '/', url: 'http://t/', origin: 'homepage', status: 'ok' }],
      perRoute: [
        {
          route: { path: '/', url: 'http://t/', origin: 'homepage', status: 'ok' },
          rendered: {
            title: 'Hello',
            h1: 'Hello World',
            headingText: 'Hello World',
            bodyPreview: 'A simple hello world site, now live in production',
          },
          perViewport: { mobile: { tiles: [] }, laptop: { tiles: [] } },
        },
      ],
      errors: [],
    },
    errors: [],
    captureErrors: [],
  };
}

describe('publishFlowExpectation fixture', () => {
  const evaluator = new ExpectedArtifactMatchEvaluator();

  it('is at evalVersion v2', () => {
    expect(publishFlowExpectation.evalVersion).toBe('v2');
  });

  it('passes when the site renders and a publish tool was called', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([publishTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('pass');
  });

  it('hard-fails when no publish tool was called', async () => {
    const noPublish: Turn = {
      role: 'assistant',
      content: 'Built the site.',
      toolCalls: [
        { id: 't1', name: 'writeFile', startTime: 0, endTime: 1 },
      ],
      timestamp: 0,
    };
    const result = await evaluator.evaluate(
      makeTranscript([noPublish]),
      makeScenario(),
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.hardFailures).toContain('invoked-publish-tool');
  });
});

describe('publishFlowExpectation directional signal (transcript-source)', () => {
  const directional = new DirectionalSignalEvaluator();

  it('scores 1 when the transcript references publish/deploy status', async () => {
    // publishTurn().content contains "Publishing ... to production".
    const result = await directional.evaluate(
      makeTranscript([publishTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBe(1);
    expect(result.details?.metCount).toBe(1);
  });

  it('scores 0 when the transcript never references publish/deploy status', async () => {
    const silentTurn: Turn = {
      role: 'assistant',
      content: 'I updated the header colors as requested.',
      toolCalls: [
        { id: 't1', name: 'writeFile', startTime: 0, endTime: 1 },
      ],
      timestamp: 0,
    };
    const result = await directional.evaluate(
      makeTranscript([silentTurn]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBe(0);
  });
});
