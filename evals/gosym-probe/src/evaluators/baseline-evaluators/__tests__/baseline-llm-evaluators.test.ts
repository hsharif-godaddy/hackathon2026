import { describe, expect, it } from 'vitest';

import type { GocodeClient } from '../../../clients/gocode-client.js';
import type { DOMSnapshot, Transcript } from '../../../runner/transcript.js';
import type { Scenario } from '../../../scenarios/types.js';
import {
  createBaselineLLMEvaluators,
  createSelectiveBaselineLLMEvaluators,
  type BaselineEvaluatorName,
} from '../baseline-llm-evaluators.js';

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
    captureErrors: [],
  };
}

describe('baseline LLM evaluators', function baselineTests() {
  it('parses a numerical evaluator JSON response', async function numerical() {
    const gocode = {
      complete: async () =>
        JSON.stringify({ score: 0.8, verdict: 'pass', reason: 'ok' }),
    } as unknown as GocodeClient;

    const evs = createBaselineLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'intent-inference-quality');
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
    const ev = evs.find((e) => e.name === 'intent-inference-quality');
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
    const ev = evs.find((e) => e.name === 'implicit-feature-gap');
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
    const ev = evs.find((e) => e.name === 'visual-layout-sanity');
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
    const ev = evs.find((e) => e.name === 'visual-layout-sanity');
    const res = await ev!.evaluate(makeTranscript(), scenario);
    expect(res.verdict).toBe('unknown');
    expect(res.score).toBe(0);
    expect(res.reason).toBe('LLM judge response did not match expected schema');
  });

  describe('createSelectiveBaselineLLMEvaluators', function selectiveTests() {
    const noopGocode = {
      complete: async () =>
        JSON.stringify({ score: 0.9, verdict: 'pass', reason: 'ok' }),
    } as unknown as GocodeClient;

    it('returns evaluators for valid names in input order', function validNames() {
      const evs = createSelectiveBaselineLLMEvaluators(noopGocode, [
        'intent-to-output-alignment',
        'silent-hallucination',
      ]);
      expect(evs).toHaveLength(2);
      expect(evs[0]!.name).toBe('intent-to-output-alignment');
      expect(evs[1]!.name).toBe('silent-hallucination');
    });

    it('throws with the bad name when an unknown name is given', function unknownName() {
      expect(() =>
        createSelectiveBaselineLLMEvaluators(
          noopGocode,
          ['nonexistent'] as unknown as readonly BaselineEvaluatorName[],
        ),
      ).toThrow('nonexistent');
    });

    it('returns an empty array for an empty names input', function emptyNames() {
      const evs = createSelectiveBaselineLLMEvaluators(noopGocode, []);
      expect(evs).toHaveLength(0);
    });

    it('returns a single evaluator for a single valid name', function singleName() {
      const evs = createSelectiveBaselineLLMEvaluators(noopGocode, [
        'scope-drift-overgeneration',
      ]);
      expect(evs).toHaveLength(1);
      expect(evs[0]!.name).toBe('scope-drift-overgeneration');
    });

    it('returns all 15 evaluators when all names are requested', function allNames() {
      const allNames = [
        'intent-inference-quality',
        'intent-to-output-alignment',
        'implicit-feature-gap',
        'trust-signal-coverage',
        'scope-drift-overgeneration',
        'primary-use-case-support',
        'conversion-path-clarity',
        'content-tone-alignment',
        'content-specificity',
        'conversation-to-artifact-consistency',
        'silent-hallucination',
        'ambiguity-handling-quality',
        'flow-efficiency',
        'structural-coherence',
        'visual-layout-sanity',
      ] as const;
      const evs = createSelectiveBaselineLLMEvaluators(noopGocode, allNames);
      expect(evs).toHaveLength(15);
      expect(evs.map((e) => e.name)).toEqual(allNames);
    });
  });

  it('strips SVG from FINAL_SITE snapshot in prompt (seam: buildEvidence uses sanitized path)', async function sanitizedFinalSite() {
    let capturedPrompt = '';
    const gocode = {
      complete: async (messages: Array<{ content: string }>) => {
        capturedPrompt = messages[0]?.content ?? '';
        return JSON.stringify({ score: 0.8, verdict: 'pass', reason: 'ok' });
      },
    } as unknown as GocodeClient;

    const snapshot: DOMSnapshot = {
      url: 'https://example.test',
      htmlPath: '',
      screenshotPath: '',
      timestamp: new Date().toISOString(),
      consoleLogs: [],
      html: '<html><body><svg><path d="M0 0"/></svg><p>Contact: 555-1234</p></body></html>',
    };

    const evs = createBaselineLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'intent-to-output-alignment')!;
    await ev.evaluate(makeTranscript(), scenario, snapshot);

    expect(capturedPrompt).toContain('FINAL_SITE (last snapshot):');
    expect(capturedPrompt).toContain('Contact: 555-1234');
    expect(capturedPrompt).not.toContain('<svg');
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
    const ev = evs.find((e) => e.name === 'intent-inference-quality');
    await ev!.evaluate(makeTranscript(), scenario);

    expect(prompt).toContain('gosym-probe is a local harness');
    expect(prompt).toContain('do not require production publishing');
    expect(prompt).toContain('Do not penalize failed, missing, or timed-out publish');
  });
});
