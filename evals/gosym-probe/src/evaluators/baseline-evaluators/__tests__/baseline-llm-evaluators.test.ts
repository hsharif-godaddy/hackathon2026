import { describe, expect, it } from 'vitest';

import type { GocodeClient } from '../../../clients/gocode-client.js';
import type { Transcript } from '../../../runner/transcript.js';
import type { Scenario } from '../../../scenarios/types.js';
import { createBaselineLLMEvaluators } from '../baseline-llm-evaluators.js';

const scenario = {
  name: 's',
  persona: { name: 'p', description: 'd', systemPrompt: 'sp' },
  goals: [{ description: 'Do the thing', assertion: 'positive' }],
  evaluators: [],
  trials: 1,
} satisfies Scenario;

function makeTranscript(): Transcript {
  return {
    scenarioName: 's',
    trialIndex: 0,
    turns: [
      { role: 'user', content: 'I need a booking site', toolCalls: [], timestamp: 1 },
    ],
    snapshots: [],
    errors: [],
  };
}

describe('baseline LLM evaluators', function baselineTests() {
  it('parses a numerical evaluator JSON response', async function numerical() {
    const gocode = {
      complete: async () =>
        JSON.stringify({ score: 0.8, verdict: 'pass', reason: 'ok' }),
    } as unknown as GocodeClient;

    const evs = createBaselineLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'intent_inference_quality');
    expect(ev).toBeDefined();

    const res = await ev!.evaluate(makeTranscript(), scenario);
    expect(res.verdict).toBe('pass');
    expect(res.score).toBeGreaterThan(0.7);
  });

  it('zeros numerical score when verdict is unknown', async function unknown() {
    const gocode = {
      complete: async () =>
        JSON.stringify({ score: 0.7, verdict: 'unknown', reason: 'unclear' }),
    } as unknown as GocodeClient;

    const evs = createBaselineLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'intent_inference_quality');
    const res = await ev!.evaluate(makeTranscript(), scenario);
    expect(res.verdict).toBe('unknown');
    expect(res.score).toBe(0);
  });

  it('maps boolean evaluator with true equals bad into fail', async function boolean() {
    const gocode = {
      complete: async () =>
        JSON.stringify({ value: true, verdict: 'pass', reason: 'gap found' }),
    } as unknown as GocodeClient;

    const evs = createBaselineLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'implicit_feature_gap');
    const res = await ev!.evaluate(makeTranscript(), scenario);
    expect(res.verdict).toBe('fail');
    expect(res.score).toBe(0);
  });

  it('maps categorical evaluator verdict to score', async function categorical() {
    const gocode = {
      complete: async () =>
        JSON.stringify({
          value: 'acceptable',
          verdict: 'partial',
          reason: 'fine',
        }),
    } as unknown as GocodeClient;

    const evs = createBaselineLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'visual_layout_sanity');
    const res = await ev!.evaluate(makeTranscript(), scenario);
    expect(res.verdict).toBe('partial');
    expect(res.score).toBe(0.5);
  });

  it('rejects categorical values outside allowed values', async function invalidCategorical() {
    const gocode = {
      complete: async () =>
        JSON.stringify({
          value: 'excellent',
          verdict: 'pass',
          reason: 'not allowed',
        }),
    } as unknown as GocodeClient;

    const evs = createBaselineLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'visual_layout_sanity');
    const res = await ev!.evaluate(makeTranscript(), scenario);
    expect(res.verdict).toBe('unknown');
    expect(res.score).toBe(0);
    expect(res.reason).toBe('LLM judge response did not match expected schema');
  });

  it('instructs judges not to penalize publish failures in local harness', async function publishBoundary() {
    let prompt = '';
    const gocode = {
      complete: async (messages: Array<{ content: string }>) => {
        prompt = messages[0]?.content ?? '';
        return JSON.stringify({ score: 0.8, verdict: 'pass', reason: 'ok' });
      },
    } as unknown as GocodeClient;

    const evs = createBaselineLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'intent_inference_quality');
    await ev!.evaluate(makeTranscript(), scenario);

    expect(prompt).toContain('gosym-probe is a local harness');
    expect(prompt).toContain('do not require production publishing');
    expect(prompt).toContain('Do not penalize failed, missing, or timed-out publish');
  });
});
