import { describe, expect, it } from 'vitest';

import type { Transcript } from '../../../runner/transcript.js';
import type { Scenario } from '../../../scenarios/types.js';
import { TotalTimeTakenEvaluator } from '../operational-efficiency.js';

const scenario = {
  name: 's',
  persona: { name: 'p', description: 'd', systemPrompt: 'sp' },
  goals: [],
  evaluators: [],
  trials: 1,
} satisfies Scenario;

describe('TotalTimeTakenEvaluator', function operationalTests() {
  it('emits raw seconds with observed verdict', async function time() {
    const t: Transcript = {
      scenarioName: 's',
      trialIndex: 0,
      turns: [
        { role: 'user', content: 'hi', toolCalls: [], timestamp: 1000 },
        { role: 'assistant', content: 'done', toolCalls: [], timestamp: 2000 },
      ],
      snapshots: [],
      errors: [],
      captureErrors: [],
    };

    const evaluator = new TotalTimeTakenEvaluator();
    const res = await evaluator.evaluate(t, scenario);
    expect(res.verdict).toBe('directional');
    expect(res.score).toBe(1);
    expect(res.details).toMatchObject({ unit: 'seconds' });
    expect(res.evalVersion).toBe('2.0');
  });

  it('returns score of 0 when start and end timestamps are equal', async function zeroSeconds() {
    const transcript: Transcript = {
      scenarioName: 's',
      trialIndex: 0,
      turns: [
        { role: 'user', content: 'hi', toolCalls: [], timestamp: 5000 },
        { role: 'assistant', content: 'done', toolCalls: [], timestamp: 5000 },
      ],
      snapshots: [],
      errors: [],
      captureErrors: [],
    };

    const evaluator = new TotalTimeTakenEvaluator();
    const res = await evaluator.evaluate(transcript, scenario);
    expect(res.verdict).toBe('directional');
    expect(res.score).toBe(0);
  });

  it('emits raw seconds for long session (unclamped)', async function longSession() {
    const transcript: Transcript = {
      scenarioName: 's',
      trialIndex: 0,
      turns: [
        { role: 'user', content: 'hi', toolCalls: [], timestamp: 0 },
        { role: 'assistant', content: 'done', toolCalls: [], timestamp: 720_000 },
      ],
      snapshots: [],
      errors: [],
      captureErrors: [],
    };

    const evaluator = new TotalTimeTakenEvaluator();
    const res = await evaluator.evaluate(transcript, scenario);
    expect(res.verdict).toBe('directional');
    expect(res.score).toBe(720);
  });

  it("returns 'unknown' when transcript has no turns", async function noTurns() {
    const transcript: Transcript = {
      scenarioName: 's',
      trialIndex: 0,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
    };

    const evaluator = new TotalTimeTakenEvaluator();
    const res = await evaluator.evaluate(transcript, scenario);
    expect(res.verdict).toBe('incomplete');
  });

  it('has correct properties', function props() {
    const evaluator = new TotalTimeTakenEvaluator();
    expect(evaluator.name).toBe('total-time-taken');
    expect(evaluator.evalVersion).toBe('2.0');
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(true);
  });
});
