import { describe, expect, it } from 'vitest';

import type { DOMSnapshot } from '../../../runner/transcript.js';
import type { GocodeClient } from '../../../clients/gocode-client.js';
import { createQualityLLMEvaluators } from '../quality-llm-evaluators.js';
import {
  testScenario as scenario,
  makeTranscript,
  makeSnapshot,
} from './dom-eval-test-helpers.js';

function makeGocode(response: object): GocodeClient {
  return {
    complete: async () => JSON.stringify(response),
  } as unknown as GocodeClient;
}

describe('createQualityLLMEvaluators', function factoryTests() {
  it('returns exactly 2 evaluators', function count() {
    const evs = createQualityLLMEvaluators(makeGocode({ score: 0.8, verdict: 'pass', reason: 'ok' }));
    expect(evs).toHaveLength(2);
  });

  it('evaluator names are visual-coherence and content-substance', function names() {
    const evs = createQualityLLMEvaluators(makeGocode({ score: 0.8, verdict: 'pass', reason: 'ok' }));
    const names = evs.map((e) => e.name);
    expect(names).toContain('visual-coherence');
    expect(names).toContain('content-substance');
  });

});

describe('visual-coherence evaluator', function visualCoherenceTests() {
  it('returns score and verdict from valid LLM response', async function passCase() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.9, verdict: 'pass', reason: 'consistent spacing and typography' }),
    );
    const ev = evs.find((e) => e.name === 'visual-coherence')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Portfolio</h1></body></html>'),
    );
    expect(result.evaluator).toBe('visual-coherence');
    expect(result.score).toBeCloseTo(0.9);
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('consistent spacing and typography');
  });

  it('returns score 0 when verdict is unknown', async function unknownVerdict() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.5, verdict: 'unknown', reason: 'no visual content' }),
    );
    const ev = evs.find((e) => e.name === 'visual-coherence')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body></body></html>'),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });

  it('returns score 0 and verdict unknown when snapshot is absent', async function noSnapshot() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0, verdict: 'unknown', reason: 'no HTML to evaluate' }),
    );
    const ev = evs.find((e) => e.name === 'visual-coherence')!;
    const result = await ev.evaluate(makeTranscript(), scenario, undefined);
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toContain('Insufficient evidence');
  });

  it('returns verdict unknown when LLM request fails', async function llmFailure() {
    const failingGocode = {
      complete: async () => { throw new Error('network error'); },
    } as unknown as GocodeClient;
    const evs = createQualityLLMEvaluators(failingGocode);
    const ev = evs.find((e) => e.name === 'visual-coherence')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toContain('network error');
  });

  it('returns partial verdict for mid-range score', async function partialCase() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.55, verdict: 'partial', reason: 'inconsistent spacing in footer' }),
    );
    const ev = evs.find((e) => e.name === 'visual-coherence')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    expect(result.score).toBeCloseTo(0.55);
    expect(result.verdict).toBe('partial');
  });

  it('includes dimension in details', async function dimensionField() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.8, verdict: 'pass', reason: 'ok' }),
    );
    const ev = evs.find((e) => e.name === 'visual-coherence')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    expect(result.details).toMatchObject({ dimension: 'Visual Coherence' });
  });
});

describe('content-substance evaluator', function contentSubstanceTests() {
  it('returns score and verdict from valid LLM response', async function passCase() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.85, verdict: 'pass', reason: 'specific business copy throughout' }),
    );
    const ev = evs.find((e) => e.name === 'content-substance')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Jane Doe, Full-Stack Developer</p></body></html>'),
    );
    expect(result.evaluator).toBe('content-substance');
    expect(result.score).toBeCloseTo(0.85);
    expect(result.verdict).toBe('pass');
  });

  it('returns score 0 when verdict is unknown', async function unknownVerdict() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.4, verdict: 'unknown', reason: 'insufficient text content' }),
    );
    const ev = evs.find((e) => e.name === 'content-substance')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><p>Some text</p></body></html>'),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });

  it('returns score 0 and verdict unknown when snapshot is absent', async function noSnapshot() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0, verdict: 'unknown', reason: 'no content to evaluate' }),
    );
    const ev = evs.find((e) => e.name === 'content-substance')!;
    const result = await ev.evaluate(makeTranscript(), scenario, undefined);
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toContain('Insufficient evidence');
  });

  it('returns verdict unknown when LLM request fails', async function llmFailure() {
    const failingGocode = {
      complete: async () => { throw new Error('timeout'); },
    } as unknown as GocodeClient;
    const evs = createQualityLLMEvaluators(failingGocode);
    const ev = evs.find((e) => e.name === 'content-substance')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><p>Content</p></body></html>'),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toContain('timeout');
  });

  it('returns fail verdict for low score', async function failCase() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.2, verdict: 'fail', reason: 'lorem ipsum placeholder text detected' }),
    );
    const ev = evs.find((e) => e.name === 'content-substance')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><p>Lorem ipsum</p></body></html>'),
    );
    expect(result.score).toBeCloseTo(0.2);
    expect(result.verdict).toBe('fail');
  });

  it('includes dimension in details', async function dimensionField() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.7, verdict: 'pass', reason: 'ok' }),
    );
    const ev = evs.find((e) => e.name === 'content-substance')!;
    const result = await ev.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><p>Real content</p></body></html>'),
    );
    expect(result.details).toMatchObject({ dimension: 'Content Substance' });
  });
});

describe('prompt content verification', function promptContentTests() {
  function makeCapturingGocode(): { gocode: GocodeClient; getPrompt: () => string } {
    let capturedPrompt = '';
    const gocode = {
      complete: async (messages: Array<{ role: string; content: string }>) => {
        capturedPrompt = messages[0]?.content ?? '';
        return JSON.stringify({ score: 0.8, verdict: 'pass', reason: 'ok' });
      },
    } as unknown as GocodeClient;
    return { gocode, getPrompt: () => capturedPrompt };
  }

  it('content-substance prompt includes BODY_HTML (sanitized) label and strips SVG', async function sanitizedLabel() {
    const { gocode, getPrompt } = makeCapturingGocode();
    const evs = createQualityLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'content-substance')!;
    const snapshot = await makeSnapshot(
      '<html><body><svg><path d="M0 0"/></svg><p>Real content</p></body></html>',
    );
    await ev.evaluate(makeTranscript(), scenario, snapshot);
    const prompt = getPrompt();
    expect(prompt).toContain('BODY_HTML (sanitized):');
    expect(prompt).not.toContain('<svg');
    expect(prompt).toContain('Real content');
  });

  it('visual-coherence prompt includes plain BODY_HTML label without sanitized', async function plainLabel() {
    const { gocode, getPrompt } = makeCapturingGocode();
    const evs = createQualityLLMEvaluators(gocode);
    const ev = evs.find((e) => e.name === 'visual-coherence')!;
    const snapshot = await makeSnapshot('<html><body><h1>Test</h1></body></html>');
    await ev.evaluate(makeTranscript(), scenario, snapshot);
    const prompt = getPrompt();
    expect(prompt).toContain('BODY_HTML:');
    expect(prompt).not.toContain('BODY_HTML (sanitized):');
  });
});

describe('inline snapshot.html support (no htmlPath)', function inlineHtmlTests() {
  it('visual-coherence evaluates inline html snapshot', async function inlineVisual() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.8, verdict: 'pass', reason: 'coherent layout' }),
    );
    const ev = evs.find((e) => e.name === 'visual-coherence')!;
    const snapshot: DOMSnapshot = {
      url: 'https://example.test',
      screenshotPath: '/tmp/test.png',
      htmlPath: '',
      timestamp: new Date().toISOString(),
      consoleLogs: [],
      html: '<html><body><h1>Inline Content</h1></body></html>',
    };
    const result = await ev.evaluate(makeTranscript(), scenario, snapshot);
    expect(result.evaluator).toBe('visual-coherence');
    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('pass');
  });

  it('content-substance evaluates inline html snapshot', async function inlineContent() {
    const evs = createQualityLLMEvaluators(
      makeGocode({ score: 0.9, verdict: 'pass', reason: 'specific content' }),
    );
    const ev = evs.find((e) => e.name === 'content-substance')!;
    const snapshot: DOMSnapshot = {
      url: 'https://example.test',
      screenshotPath: '/tmp/test.png',
      htmlPath: '',
      timestamp: new Date().toISOString(),
      consoleLogs: [],
      html: '<html><body><p>Jane Doe, Full-Stack Developer</p></body></html>',
    };
    const result = await ev.evaluate(makeTranscript(), scenario, snapshot);
    expect(result.evaluator).toBe('content-substance');
    expect(result.score).toBeCloseTo(0.9);
    expect(result.verdict).toBe('pass');
  });
});
