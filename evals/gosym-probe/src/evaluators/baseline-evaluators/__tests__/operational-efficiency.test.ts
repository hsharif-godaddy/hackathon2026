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
  it('computes total_time_taken from turn timestamps', async function time() {
    const t: Transcript = {
      scenarioName: 's',
      trialIndex: 0,
      turns: [
        { role: 'user', content: 'hi', toolCalls: [], timestamp: 1000 },
        { role: 'assistant', content: 'done', toolCalls: [], timestamp: 2000 },
      ],
      snapshots: [],
      errors: [],
    };

    const res = await new TotalTimeTakenEvaluator().evaluate(t, scenario);
    expect(res.verdict).toBe('pass');
    expect(res.score).toBe(1);
    expect(res.details).toMatchObject({ unit: 'seconds' });
  });

  it('scales total_time_taken thresholds by max turns', async function scales() {
    const transcript: Transcript = {
      scenarioName: 's',
      trialIndex: 0,
      turns: [
        { role: 'user', content: 'hi', toolCalls: [], timestamp: 0 },
        { role: 'assistant', content: 'done', toolCalls: [], timestamp: 120_000 },
      ],
      snapshots: [],
      errors: [],
    };

    expect(
      (await new TotalTimeTakenEvaluator().evaluate(transcript, {
        ...scenario,
        maxTurns: 25,
      })).score,
    ).toBeLessThan(
      (await new TotalTimeTakenEvaluator().evaluate(transcript, {
        ...scenario,
        maxTurns: 45,
      })).score,
    );
  });
});
