import { describe, expect, it, vi } from 'vitest';

import type { DOMSnapshot } from '../../../runner/transcript.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import { createQualityLLMEvaluators } from '../quality-llm-evaluators.js';
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

function makeFailingGocode(message: string): IGocodeClient {
  return {
    complete: async () => { throw new Error(message); },
  } as unknown as IGocodeClient;
}

function makeMalformedGocode(response: string): IGocodeClient {
  return {
    complete: async () => response,
  } as unknown as IGocodeClient;
}

const VISUAL_ITEMS: ItemResponse[] = [
  { id: 'spacing-consistency', met: true, reason: 'even spacing' },
  { id: 'typography-hierarchy', met: true, reason: 'clear hierarchy' },
  { id: 'color-harmony', met: false, reason: 'clashing palette' },
  { id: 'layout-rhythm', met: true, reason: 'consistent grid' },
];

const CONTENT_ITEMS: ItemResponse[] = [
  { id: 'no-placeholder-text', met: true, reason: 'no lorem ipsum' },
  { id: 'content-specificity', met: true, reason: 'specific copy' },
  { id: 'concrete-details', met: false, reason: 'missing pricing' },
  { id: 'domain-vocabulary', met: true, reason: 'relevant terms' },
];

// ---------------------------------------------------------------------------
// Factory shape
// ---------------------------------------------------------------------------

describe('createQualityLLMEvaluators factory', function factory() {
  it('returns visualCoherence, contentSubstanceInv, contentSubstanceDir', function keys() {
    const result = createQualityLLMEvaluators(makeGocode([]));
    expect(result).toHaveProperty('visualCoherence');
    expect(result).toHaveProperty('contentSubstanceInv');
    expect(result).toHaveProperty('contentSubstanceDir');
  });

  it('visualCoherence name is visual-coherence', function visualName() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode([]));
    expect(visualCoherence.name).toBe('visual-coherence');
  });

  it('contentSubstanceInv name is content-substance-inv', function invName() {
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeGocode([]));
    expect(contentSubstanceInv.name).toBe('content-substance-inv');
  });

  it('contentSubstanceDir name is content-substance-dir', function dirName() {
    const { contentSubstanceDir } = createQualityLLMEvaluators(makeGocode([]));
    expect(contentSubstanceDir.name).toBe('content-substance-dir');
  });

  it('visualCoherence has comparisonMode score', function visualReg() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode([]));
    expect(visualCoherence.comparisonMode).toBe('score');
  });

  it('contentSubstanceInv has comparisonMode passRate', function invReg() {
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeGocode([]));
    expect(contentSubstanceInv.comparisonMode).toBe('passRate');
  });

  it('contentSubstanceDir has comparisonMode score', function dirReg() {
    const { contentSubstanceDir } = createQualityLLMEvaluators(makeGocode([]));
    expect(contentSubstanceDir.comparisonMode).toBe('score');
  });
});

// ---------------------------------------------------------------------------
// visual-coherence: validation boundary — per-dimension typed checks
// ---------------------------------------------------------------------------

describe('visual-coherence: validation boundary', function visualBoundary() {
  it('returns 4 checklist items from a valid LLM response', async function fourItems() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode(VISUAL_ITEMS));
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Portfolio</h1></body></html>'),
    );
    const items = (result.details as { items?: unknown[] }).items;
    expect(items).toHaveLength(4);
  });

  it('all 4 visual checks are type directional', async function allDirectional() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode(VISUAL_ITEMS));
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    const items = (result.details as { items: Array<{ type: string }> }).items;
    for (const item of items) {
      expect(item.type).toBe('directional');
    }
  });

  it('met: true -> status pass', async function metTrue() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode(VISUAL_ITEMS));
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    const items = (result.details as { items: Array<{ id: string; status: string }> }).items;
    const spacingItem = items.find((i) => i.id === 'spacing-consistency');
    expect(spacingItem?.status).toBe('pass');
  });

  it('met: false -> status fail', async function metFalse() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode(VISUAL_ITEMS));
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    const items = (result.details as { items: Array<{ id: string; status: string }> }).items;
    const colorItem = items.find((i) => i.id === 'color-harmony');
    expect(colorItem?.status).toBe('fail');
  });

  it('check ids match the 4 declared dimension ids', async function checkIds() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode(VISUAL_ITEMS));
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    const items = (result.details as { items: Array<{ id: string }> }).items;
    const ids = items.map((i) => i.id);
    expect(ids).toContain('spacing-consistency');
    expect(ids).toContain('typography-hierarchy');
    expect(ids).toContain('color-harmony');
    expect(ids).toContain('layout-rhythm');
  });

  it('verdict is directional (DIR-only scoremode evaluator)', async function verdictDirectional() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode(VISUAL_ITEMS));
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    expect(result.verdict).toBe('directional');
  });
});

// ---------------------------------------------------------------------------
// content-substance-inv: INV adapter
// ---------------------------------------------------------------------------

describe('content-substance-inv: validation boundary', function invBoundary() {
  it('no-placeholder-text fail -> verdict fail', async function invFail() {
    const invFailItems: ItemResponse[] = [
      { id: 'no-placeholder-text', met: false, reason: 'lorem ipsum found' },
      { id: 'content-specificity', met: true, reason: 'specific' },
      { id: 'concrete-details', met: true, reason: 'details present' },
      { id: 'domain-vocabulary', met: true, reason: 'relevant' },
    ];
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeGocode(invFailItems));
    const result = await contentSubstanceInv.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Lorem ipsum</p></body></html>'),
    );
    expect(result.verdict).toBe('fail');
  });

  it('no-placeholder-text pass -> verdict pass', async function invPass() {
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeGocode(CONTENT_ITEMS));
    const result = await contentSubstanceInv.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Real content</p></body></html>'),
    );
    expect(result.verdict).toBe('pass');
  });

  it('only exposes INV items in details', async function invItemsOnly() {
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeGocode(CONTENT_ITEMS));
    const result = await contentSubstanceInv.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Real content</p></body></html>'),
    );
    const items = (result.details as { items?: Array<{ type: string }> }).items ?? [];
    for (const item of items) {
      expect(item.type).toBe('invariance');
    }
  });
});

// ---------------------------------------------------------------------------
// content-substance-dir: DIR adapter
// ---------------------------------------------------------------------------

describe('content-substance-dir: validation boundary', function dirBoundary() {
  it('all DIR pass -> verdict directional, score 1.0', async function allDirPass() {
    const allPass: ItemResponse[] = [
      { id: 'no-placeholder-text', met: true, reason: 'no lorem ipsum' },
      { id: 'content-specificity', met: true, reason: 'specific copy' },
      { id: 'concrete-details', met: true, reason: 'has details' },
      { id: 'domain-vocabulary', met: true, reason: 'relevant terms' },
    ];
    const { contentSubstanceDir } = createQualityLLMEvaluators(makeGocode(allPass));
    const result = await contentSubstanceDir.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Real content</p></body></html>'),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1.0);
  });

  it('some DIR fail -> score less than 1.0', async function someDirFail() {
    const { contentSubstanceDir } = createQualityLLMEvaluators(makeGocode(CONTENT_ITEMS));
    const result = await contentSubstanceDir.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Real content</p></body></html>'),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeLessThan(1.0);
  });

  it('only exposes DIR items in details', async function dirItemsOnly() {
    const { contentSubstanceDir } = createQualityLLMEvaluators(makeGocode(CONTENT_ITEMS));
    const result = await contentSubstanceDir.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Real content</p></body></html>'),
    );
    const items = (result.details as { items?: Array<{ type: string }> }).items ?? [];
    for (const item of items) {
      expect(item.type).toBe('directional');
    }
  });
});

// ---------------------------------------------------------------------------
// Error path: LLM failure -> incomplete checks, excluded from denominators
// ---------------------------------------------------------------------------

describe('error path: LLM failure -> incomplete checks', function errorPath() {
  it('visual-coherence: LLM throw -> incomplete verdict, no items in details', async function visualThrow() {
    const { visualCoherence } = createQualityLLMEvaluators(makeFailingGocode('network error'));
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    expect(result.verdict).toBe('incomplete');
    const items = (result.details as { items?: unknown[] } | undefined)?.items;
    expect(items).toBeUndefined();
  });

  it('content-substance-inv: LLM throw -> incomplete verdict', async function invThrow() {
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeFailingGocode('timeout'));
    const result = await contentSubstanceInv.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Content</p></body></html>'),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('content-substance-dir: LLM throw -> incomplete verdict', async function dirThrow() {
    const { contentSubstanceDir } = createQualityLLMEvaluators(makeFailingGocode('timeout'));
    const result = await contentSubstanceDir.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Content</p></body></html>'),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('visual-coherence: malformed JSON -> incomplete verdict', async function visualMalformed() {
    const { visualCoherence } = createQualityLLMEvaluators(makeMalformedGocode('not json at all'));
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('content-substance-inv: malformed JSON -> incomplete verdict', async function invMalformed() {
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeMalformedGocode('{broken'));
    const result = await contentSubstanceInv.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Content</p></body></html>'),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('visual-coherence: wrong schema (numerical) -> incomplete verdict', async function visualWrongSchema() {
    const { visualCoherence } = createQualityLLMEvaluators(
      makeMalformedGocode(JSON.stringify({ score: 0.9, verdict: 'pass', reason: 'old schema' })),
    );
    const result = await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('visual-coherence: no snapshot -> incomplete verdict', async function visualNoSnapshot() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode(VISUAL_ITEMS));
    const result = await visualCoherence.evaluate(makeTranscript(), scenario, undefined);
    expect(result.verdict).toBe('incomplete');
  });

  it('content-substance-inv: no snapshot -> incomplete verdict', async function invNoSnapshot() {
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeGocode(CONTENT_ITEMS));
    const result = await contentSubstanceInv.evaluate(makeTranscript(), scenario, undefined);
    expect(result.verdict).toBe('incomplete');
  });
});

// ---------------------------------------------------------------------------
// Memoization: each judge fires exactly once per trial across both adapters
// ---------------------------------------------------------------------------

describe('memoization: model call fires exactly once per trial', function memoization() {
  it('visual-coherence: two calls with same snapshot -> model invoked once', async function visualOnce() {
    let callCount = 0;
    const gocode: IGocodeClient = {
      complete: async () => {
        callCount++;
        return JSON.stringify({ items: VISUAL_ITEMS });
      },
    } as unknown as IGocodeClient;

    const { visualCoherence } = createQualityLLMEvaluators(gocode);
    const snapshot = await makeSnapshot('<html><body><h1>Test</h1></body></html>');
    const transcript = makeTranscript();

    await visualCoherence.evaluate(transcript, scenario, snapshot);
    callCount = 0;

    await visualCoherence.evaluate(transcript, scenario, snapshot);
    expect(callCount).toBe(0);
  });

  it('visual-coherence: different snapshot objects -> model invoked each time', async function visualNewSnapshot() {
    let callCount = 0;
    const gocode: IGocodeClient = {
      complete: async () => {
        callCount++;
        return JSON.stringify({ items: VISUAL_ITEMS });
      },
    } as unknown as IGocodeClient;

    const { visualCoherence } = createQualityLLMEvaluators(gocode);
    const snapshot1 = await makeSnapshot('<html><body><h1>Trial 1</h1></body></html>');
    const snapshot2 = await makeSnapshot('<html><body><h1>Trial 2</h1></body></html>');
    const transcript = makeTranscript();

    await visualCoherence.evaluate(transcript, scenario, snapshot1);
    const countAfterFirst = callCount;
    await visualCoherence.evaluate(transcript, scenario, snapshot2);
    expect(callCount).toBe(countAfterFirst + 1);
  });

  it('inv and dir adapters share one LLM call for content-substance per trial', async function sharedMemo() {
    const completeSpy = vi.fn().mockResolvedValue(JSON.stringify({ items: CONTENT_ITEMS }));
    const gocode: IGocodeClient = { complete: completeSpy } as unknown as IGocodeClient;

    const { contentSubstanceInv, contentSubstanceDir } = createQualityLLMEvaluators(gocode);
    const snapshot = await makeSnapshot('<html><body><p>Content</p></body></html>');
    const transcript = makeTranscript();

    await Promise.all([
      contentSubstanceInv.evaluate(transcript, scenario, snapshot),
      contentSubstanceDir.evaluate(transcript, scenario, snapshot),
    ]);

    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  it('content-substance-inv spy: model called once even with multiple calls', async function invSpy() {
    const completeSpy = vi.fn().mockResolvedValue(JSON.stringify({ items: CONTENT_ITEMS }));
    const gocode: IGocodeClient = { complete: completeSpy } as unknown as IGocodeClient;

    const { contentSubstanceInv } = createQualityLLMEvaluators(gocode);
    const snapshot = await makeSnapshot('<html><body><p>Content</p></body></html>');
    const transcript = makeTranscript();

    await contentSubstanceInv.evaluate(transcript, scenario, snapshot);
    await contentSubstanceInv.evaluate(transcript, scenario, snapshot);
    await contentSubstanceInv.evaluate(transcript, scenario, snapshot);

    expect(completeSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Prompt content: prompt includes dimension ids
// ---------------------------------------------------------------------------

describe('prompt content', function promptContent() {
  it('visual-coherence prompt enumerates the 4 dimension ids', async function visualPromptIds() {
    let capturedPrompt = '';
    const gocode: IGocodeClient = {
      complete: async (messages: Array<{ role: string; content: string }>) => {
        capturedPrompt = messages[0]?.content ?? '';
        return JSON.stringify({ items: VISUAL_ITEMS });
      },
    } as unknown as IGocodeClient;

    const { visualCoherence } = createQualityLLMEvaluators(gocode);
    await visualCoherence.evaluate(
      makeTranscript(), scenario, await makeSnapshot('<html><body><h1>Test</h1></body></html>'),
    );

    expect(capturedPrompt).toContain('spacing-consistency');
    expect(capturedPrompt).toContain('typography-hierarchy');
    expect(capturedPrompt).toContain('color-harmony');
    expect(capturedPrompt).toContain('layout-rhythm');
  });

  it('content-substance prompt enumerates the 4 dimension ids', async function contentPromptIds() {
    let capturedPrompt = '';
    const gocode: IGocodeClient = {
      complete: async (messages: Array<{ role: string; content: string }>) => {
        capturedPrompt = messages[0]?.content ?? '';
        return JSON.stringify({ items: CONTENT_ITEMS });
      },
    } as unknown as IGocodeClient;

    const { contentSubstanceInv } = createQualityLLMEvaluators(gocode);
    await contentSubstanceInv.evaluate(
      makeTranscript(), scenario,
      await makeSnapshot('<html><body><p>Content</p></body></html>'),
    );

    expect(capturedPrompt).toContain('no-placeholder-text');
    expect(capturedPrompt).toContain('content-specificity');
    expect(capturedPrompt).toContain('concrete-details');
    expect(capturedPrompt).toContain('domain-vocabulary');
  });
});

// ---------------------------------------------------------------------------
// Inline snapshot support (no htmlPath)
// ---------------------------------------------------------------------------

describe('inline snapshot.html support', function inlineHtml() {
  it('visual-coherence evaluates inline html snapshot', async function inlineVisual() {
    const { visualCoherence } = createQualityLLMEvaluators(makeGocode(VISUAL_ITEMS));
    const snapshot: DOMSnapshot = {
      url: 'https://example.test',
      screenshotPath: '/tmp/test.png',
      htmlPath: '',
      timestamp: new Date().toISOString(),
      consoleLogs: [],
      html: '<html><body><h1>Inline Content</h1></body></html>',
    };
    const result = await visualCoherence.evaluate(makeTranscript(), scenario, snapshot);
    expect(result.evaluator).toBe('visual-coherence');
    const items = (result.details as { items?: unknown[] }).items;
    expect(items).toHaveLength(4);
  });

  it('content-substance-inv evaluates inline html snapshot', async function inlineInv() {
    const { contentSubstanceInv } = createQualityLLMEvaluators(makeGocode(CONTENT_ITEMS));
    const snapshot: DOMSnapshot = {
      url: 'https://example.test',
      screenshotPath: '/tmp/test.png',
      htmlPath: '',
      timestamp: new Date().toISOString(),
      consoleLogs: [],
      html: '<html><body><p>Jane Doe, Full-Stack Developer</p></body></html>',
    };
    const result = await contentSubstanceInv.evaluate(makeTranscript(), scenario, snapshot);
    expect(result.evaluator).toBe('content-substance-inv');
  });
});
