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

describe('baseline operational efficiency', function operationalTests() {
  it('computes total-time-taken from turn timestamps', async function time() {
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
    expect(evaluator.evalVersion).toBe('1.1');
    const res = await evaluator.evaluate(t, scenario);
    expect(res.verdict).toBe('pass');
    expect(res.score).toBe(1);
    expect(res.details).toMatchObject({ unit: 'seconds' });
    expect(res.evalVersion).toBe('1.1');
  });

  it('returns partial for duration between perfect and zero thresholds', async function partial() {
    const transcript: Transcript = {
      scenarioName: 's',
      trialIndex: 0,
      turns: [
        { role: 'user', content: 'hi', toolCalls: [], timestamp: 0 },
        { role: 'assistant', content: 'done', toolCalls: [], timestamp: 400_000 },
      ],
      snapshots: [],
      errors: [],
      captureErrors: [],
      
    };

    const evaluator = new TotalTimeTakenEvaluator();
    const res = await evaluator.evaluate(transcript, scenario);
    expect(res.verdict).toBe('partial');
    expect(res.score).toBeGreaterThan(0);
    expect(res.score).toBeLessThan(1);
  });

  it('returns fail for duration exceeding zero threshold', async function fail() {
    const transcript: Transcript = {
      scenarioName: 's',
      trialIndex: 0,
      turns: [
        { role: 'user', content: 'hi', toolCalls: [], timestamp: 0 },
        { role: 'assistant', content: 'done', toolCalls: [], timestamp: 800_000 },
      ],
      snapshots: [],
      errors: [],
      captureErrors: [],
      
    };

    const evaluator = new TotalTimeTakenEvaluator();
    const res = await evaluator.evaluate(transcript, scenario);
    expect(res.verdict).toBe('fail');
    expect(res.score).toBe(0);
  });
});
