import { describe, expect, it, vi } from 'vitest';

import type { IGocodeClient } from '../../../clients/gocode-client.js';
import { createGoldenLightEvaluators } from '../index.js';
import {
  testScenario as scenario,
  makeTranscript,
  makeSnapshot,
} from './dom-eval-test-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ItemResponse = { id: string; met: boolean; reason: string };

function makeGocode(items: ItemResponse[]): IGocodeClient {
  return {
    complete: async () => JSON.stringify({ items }),
  } as unknown as IGocodeClient;
}

// Full HTML with viewport meta so responsive-readiness passes
// (it's the only INV deterministic spec that always canScore)
const HTML_INV_PASS = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><p>Real content</p></body></html>';
const HTML_INV_FAIL = '<html><body><p>Lorem ipsum dolor sit amet</p></body></html>';

// All INV dimensions pass, all DIR dimensions pass
const ALL_PASS_ITEMS: ItemResponse[] = [
  { id: 'no-placeholder-text', met: true, reason: 'no lorem ipsum' },
  { id: 'content-specificity', met: true, reason: 'specific copy' },
  { id: 'concrete-details', met: true, reason: 'has pricing' },
  { id: 'domain-vocabulary', met: true, reason: 'relevant terms' },
];

// INV dimension fails (no-placeholder-text)
const INV_FAIL_ITEMS: ItemResponse[] = [
  { id: 'no-placeholder-text', met: false, reason: 'lorem ipsum found' },
  { id: 'content-specificity', met: true, reason: 'specific copy' },
  { id: 'concrete-details', met: true, reason: 'has pricing' },
  { id: 'domain-vocabulary', met: true, reason: 'relevant terms' },
];

// DIR dimensions fail, INV passes
const DIR_FAIL_ITEMS: ItemResponse[] = [
  { id: 'no-placeholder-text', met: true, reason: 'no lorem ipsum' },
  { id: 'content-specificity', met: false, reason: 'generic copy' },
  { id: 'concrete-details', met: false, reason: 'missing details' },
  { id: 'domain-vocabulary', met: false, reason: 'irrelevant terms' },
];

// ---------------------------------------------------------------------------
// Factory shape
// ---------------------------------------------------------------------------

describe('createGoldenLightEvaluators: factory shape', function factoryShape() {
  it('returns exactly 2 evaluators', function count() {
    const evs = createGoldenLightEvaluators(makeGocode(ALL_PASS_ITEMS));
    expect(evs).toHaveLength(2);
  });

  it('output-quality-passrate has comparisonMode passRate', function passrateMode() {
    const evs = createGoldenLightEvaluators(makeGocode(ALL_PASS_ITEMS));
    const ev = evs.find((e) => e.name === 'output-quality-passrate')!;
    expect(ev).toBeDefined();
    expect(ev.comparisonMode).toBe('passRate');
  });

  it('output-quality-scoremode has comparisonMode score', function scoremodeMode() {
    const evs = createGoldenLightEvaluators(makeGocode(ALL_PASS_ITEMS));
    const ev = evs.find((e) => e.name === 'output-quality-scoremode')!;
    expect(ev).toBeDefined();
    expect(ev.comparisonMode).toBe('score');
  });

  it('both evaluators report evalVersion 3.0', function evalVersions() {
    const evs = createGoldenLightEvaluators(makeGocode(ALL_PASS_ITEMS));
    for (const ev of evs) {
      expect((ev as { evalVersion?: string }).evalVersion).toBe('3.0');
    }
  });
});

// ---------------------------------------------------------------------------
// INV failure routing
// ---------------------------------------------------------------------------

describe('INV failure routing', function invRouting() {
  it('INV check failure -> output-quality-passrate verdict fail', async function invFailsGate() {
    const completeSpy = vi.fn().mockResolvedValue(JSON.stringify({ items: INV_FAIL_ITEMS }));
    const gocode: IGocodeClient = { complete: completeSpy } as unknown as IGocodeClient;
    const evs = createGoldenLightEvaluators(gocode);
    const gate = evs.find((e) => e.name === 'output-quality-passrate')!;
    const snapshot = await makeSnapshot(HTML_INV_FAIL);
    const result = await gate.evaluate(makeTranscript(), scenario, snapshot);
    expect(result.verdict).toBe('fail');
  });

  it('INV check failure -> output-quality-passrate details._composite is binary', async function invGateComposite() {
    const evs = createGoldenLightEvaluators(makeGocode(INV_FAIL_ITEMS));
    const gate = evs.find((e) => e.name === 'output-quality-passrate')!;
    const snapshot = await makeSnapshot(HTML_INV_FAIL);
    const result = await gate.evaluate(makeTranscript(), scenario, snapshot);
    expect((result.details as { _composite?: string })._composite).toBe('binary');
  });

  it('INV check failure does NOT affect output-quality-scoremode verdict', async function invNoScoreImpact() {
    const evs = createGoldenLightEvaluators(makeGocode(INV_FAIL_ITEMS));
    const scoremode = evs.find((e) => e.name === 'output-quality-scoremode')!;
    const snapshot = await makeSnapshot(HTML_INV_PASS);
    const result = await scoremode.evaluate(makeTranscript(), scenario, snapshot);
    // DIR items all pass even though INV fails — scoremode should not be 'fail'
    expect(result.verdict).not.toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// DIR failure routing
// ---------------------------------------------------------------------------

describe('DIR failure routing', function dirRouting() {
  it('DIR-only failure -> output-quality-passrate verdict pass (INV all pass)', async function dirFailsScoreOnly() {
    const evs = createGoldenLightEvaluators(makeGocode(DIR_FAIL_ITEMS));
    const gate = evs.find((e) => e.name === 'output-quality-passrate')!;
    // HTML_INV_PASS has viewport meta so responsive-readiness passes; no links/headings → other INV specs are unknown
    const snapshot = await makeSnapshot(HTML_INV_PASS);
    const result = await gate.evaluate(makeTranscript(), scenario, snapshot);
    expect(result.verdict).toBe('pass');
  });

  it('DIR-only failure -> output-quality-scoremode score decreases', async function dirFailsScore() {
    const allPassGocode = makeGocode(ALL_PASS_ITEMS);
    const dirFailGocode = makeGocode(DIR_FAIL_ITEMS);

    const [passSnapshot, failSnapshot] = await Promise.all([
      makeSnapshot(HTML_INV_PASS),
      makeSnapshot(HTML_INV_PASS),
    ]);

    const evsPass = createGoldenLightEvaluators(allPassGocode);
    const evsDir = createGoldenLightEvaluators(dirFailGocode);

    const scoremodePass = evsPass.find((e) => e.name === 'output-quality-scoremode')!;
    const scoremodeDir = evsDir.find((e) => e.name === 'output-quality-scoremode')!;

    const resultPass = await scoremodePass.evaluate(makeTranscript(), scenario, passSnapshot);
    const resultFail = await scoremodeDir.evaluate(makeTranscript(), scenario, failSnapshot);

    expect(resultFail.score).toBeLessThan(resultPass.score);
  });

  it('DIR failure -> output-quality-scoremode details._composite is mean', async function dirScoreMean() {
    const evs = createGoldenLightEvaluators(makeGocode(DIR_FAIL_ITEMS));
    const scoremode = evs.find((e) => e.name === 'output-quality-scoremode')!;
    const snapshot = await makeSnapshot(HTML_INV_PASS);
    const result = await scoremode.evaluate(makeTranscript(), scenario, snapshot);
    expect((result.details as { _composite?: string })._composite).toBe('mean');
  });
});

// ---------------------------------------------------------------------------
// Memoization: gocode.complete called exactly once per trial across both composites
// ---------------------------------------------------------------------------

describe('memoization: content-substance LLM called once per trial', function memoization() {
  it('gocode.complete called exactly once when both composites evaluate the same snapshot', async function onceBothTracks() {
    const completeSpy = vi.fn().mockImplementation(async () => {
      return JSON.stringify({ items: ALL_PASS_ITEMS });
    });
    const gocode: IGocodeClient = { complete: completeSpy } as unknown as IGocodeClient;

    const evs = createGoldenLightEvaluators(gocode);
    const gate = evs.find((e) => e.name === 'output-quality-passrate')!;
    const scoremode = evs.find((e) => e.name === 'output-quality-scoremode')!;

    const snapshot = await makeSnapshot(HTML_INV_PASS);
    const transcript = makeTranscript();

    await Promise.all([
      gate.evaluate(transcript, scenario, snapshot),
      scoremode.evaluate(transcript, scenario, snapshot),
    ]);

    // visual-coherence + content-substance = 2 LLM calls max
    // content-substance-inv and content-substance-dir share one memoized instance
    // so total calls should be exactly 2 (one per judge), not 3
    expect(completeSpy).toHaveBeenCalledTimes(2);
  });

  it('different transcript/snapshot objects produce separate LLM calls', async function separateTrials() {
    const completeSpy = vi.fn().mockImplementation(async () => {
      return JSON.stringify({ items: ALL_PASS_ITEMS });
    });
    const gocode: IGocodeClient = { complete: completeSpy } as unknown as IGocodeClient;

    const evs = createGoldenLightEvaluators(gocode);
    const gate = evs.find((e) => e.name === 'output-quality-passrate')!;

    const snapshot1 = await makeSnapshot(HTML_INV_PASS);
    const snapshot2 = await makeSnapshot(HTML_INV_PASS);

    await gate.evaluate(makeTranscript(), scenario, snapshot1);
    const callsAfterFirst = completeSpy.mock.calls.length;
    await gate.evaluate(makeTranscript(), scenario, snapshot2);
    expect(completeSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
