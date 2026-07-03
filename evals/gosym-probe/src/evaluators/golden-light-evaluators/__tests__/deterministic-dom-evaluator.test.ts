import { describe, expect, it, vi } from 'vitest';

import type { ChecklistItemOutcome, ScoreSpec, StructuralEvalSpec, StructuralScoreResult } from '../dom-eval-types.js';
import { DeterministicDomEvaluator } from '../deterministic-dom-evaluator.js';
import { responsiveReadinessSpec } from '../specs/responsive-readiness.js';
import {
  testScenario as scenario,
  makeTranscript,
  makeSnapshot,
} from './dom-eval-test-helpers.js';

function makeSpec(
  overrides: Partial<ScoreSpec> & {
    scoreResult?: Partial<StructuralScoreResult> | 'throw';
  } = {},
): ScoreSpec {
  const { scoreResult, ...rest } = overrides;
  return {
    name: 'test_evaluator',
    dimension: 'test_dimension',
    description: 'A test spec',
    comparisonMode: 'score',
    score: (bodyHtml: string): StructuralScoreResult => {
      if (scoreResult === 'throw') throw new Error('spec error');
      return {
        score: 0.8,
        canScore: true,
        reason: `scored ${bodyHtml.length} chars`,
        details: { charCount: bodyHtml.length },
        ...scoreResult,
      };
    },
    ...rest,
  };
}

describe('DeterministicDomEvaluator', function tests() {
  describe('unknown verdict cases', function unknownCases() {
    it('returns unknown when no snapshot provided', async function noSnapshot() {
      const evaluator = new DeterministicDomEvaluator(makeSpec());
      const result = await evaluator.evaluate(makeTranscript(), scenario, undefined);
      expect(result.verdict).toBe('incomplete');
      expect(result.evaluator).toBe('test_evaluator');
      expect(result.score).toBe(0);
    });

    it('returns unknown when snapshot html is empty string', async function emptyHtml() {
      const evaluator = new DeterministicDomEvaluator(makeSpec());
      const result = await evaluator.evaluate(makeTranscript(), scenario, await makeSnapshot(''));
      expect(result.verdict).toBe('incomplete');
    });

    it('returns unknown when snapshot html is whitespace only', async function whitespaceHtml() {
      const evaluator = new DeterministicDomEvaluator(makeSpec());
      const result = await evaluator.evaluate(makeTranscript(), scenario, await makeSnapshot('   \n\t  '));
      expect(result.verdict).toBe('incomplete');
    });

    it('returns unknown when spec returns canScore: false', async function canScoreFalse() {
      const evaluator = new DeterministicDomEvaluator(
        makeSpec({ scoreResult: { canScore: false } }),
      );
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(result.verdict).toBe('incomplete');
    });

    it('returns unknown when spec throws', async function specThrows() {
      const evaluator = new DeterministicDomEvaluator(makeSpec({ scoreResult: 'throw' }));
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(result.verdict).toBe('incomplete');
    });
  });

  describe('score clamping', function clampTests() {
    it('clamps score above 1.0 to 1.0', async function clampHigh() {
      const evaluator = new DeterministicDomEvaluator(
        makeSpec({ scoreResult: { score: 1.5, canScore: true } }),
      );
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>hello</p></body></html>'),
      );
      expect(result.score).toBe(1.0);
      expect(result.verdict).toBe('pass');
    });

    it('clamps score below 0.0 to 0.0', async function clampLow() {
      const evaluator = new DeterministicDomEvaluator(
        makeSpec({ scoreResult: { score: -0.5, canScore: true } }),
      );
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>hello</p></body></html>'),
      );
      expect(result.score).toBe(0.0);
      expect(result.verdict).toBe('fail');
    });
  });

  describe('result shape', function shapeTests() {
    it('evaluator field matches spec name', async function evalName() {
      const spec = makeSpec({ name: 'my_custom_evaluator' });
      const evaluator = new DeterministicDomEvaluator(spec);
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>hello</p></body></html>'),
      );
      expect(result.evaluator).toBe('my_custom_evaluator');
    });

    it('details always includes dimension', async function detailsDimension() {
      const spec = makeSpec({ dimension: 'semantic_density' });
      const evaluator = new DeterministicDomEvaluator(spec);
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>hello</p></body></html>'),
      );
      expect(result.details).toMatchObject({ dimension: 'semantic_density' });
    });

    it('passes score and reason from spec result', async function scoreAndReason() {
      const evaluator = new DeterministicDomEvaluator(
        makeSpec({ scoreResult: { score: 0.75, canScore: true, reason: 'spec says so' } }),
      );
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>hello</p></body></html>'),
      );
      expect(result.score).toBe(0.75);
      expect(result.reason).toBe('spec says so');
    });
  });

  describe('html with no body tag', function noBodyTag() {
    it('still scores when html has no body tag (falls back to full html)', async function noBody() {
      const evaluator = new DeterministicDomEvaluator(makeSpec());
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<div>some content without body tags</div>'),
      );
      // spec default returns canScore: true, score: 0.8
      expect(result.verdict).not.toBe('incomplete');
      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe('dev attribute stripping', function devAttrStripping() {
    it('strips data-dev-* attributes before passing to spec', async function stripDevAttrs() {
      let capturedHtml = '';
      const spec: StructuralEvalSpec = {
        name: 'capture_spec',
        dimension: 'capture',
        description: 'Captures html passed to score',
        comparisonMode: 'score',
        score: (bodyHtml: string): StructuralScoreResult => {
          capturedHtml = bodyHtml;
          return { score: 1.0, canScore: true, reason: 'ok', details: {} };
        },
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot(
          '<html><body><div data-dev-file="src/App.tsx" data-dev-line="10">content</div></body></html>',
        ),
      );
      expect(capturedHtml).not.toContain('data-dev-file');
      expect(capturedHtml).not.toContain('data-dev-line');
      expect(capturedHtml).toContain('content');
    });

    it('strips data-dev-* attributes that use single quotes', async function stripSingleQuotedDevAttrs() {
      let capturedHtml = '';
      const spec: StructuralEvalSpec = {
        name: 'capture_spec',
        dimension: 'capture',
        description: 'Captures html passed to score',
        comparisonMode: 'score',
        score: (bodyHtml: string): StructuralScoreResult => {
          capturedHtml = bodyHtml;
          return { score: 1.0, canScore: true, reason: 'ok', details: {} };
        },
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot(
          "<html><body><div data-dev-file='src/App.tsx' data-dev-line='42'>content</div></body></html>",
        ),
      );
      expect(capturedHtml).not.toContain('data-dev-file');
      expect(capturedHtml).not.toContain('data-dev-line');
      expect(capturedHtml).toContain('content');
    });
  });

  describe('dev attribute preservation', function devAttrPreservation() {
    it('preserves data-dev-* attributes when spec sets keepDevAttributes: true', async function preserveDevAttrs() {
      let capturedHtml = '';
      const spec: StructuralEvalSpec = {
        name: 'provenance_spec',
        dimension: 'provenance',
        description: 'Needs dev attributes for component analysis',
        comparisonMode: 'score',
        keepDevAttributes: true,
        score: (bodyHtml: string): StructuralScoreResult => {
          capturedHtml = bodyHtml;
          return { score: 1.0, canScore: true, reason: 'ok', details: {} };
        },
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot(
          '<html><body><div data-dev-file="src/App.tsx" data-dev-line="10">content</div></body></html>',
        ),
      );
      expect(capturedHtml).toContain('data-dev-file="src/App.tsx"');
      expect(capturedHtml).toContain('data-dev-line="10"');
      expect(capturedHtml).toContain('content');
    });
  });

  describe('error logging', function errorLogging() {
    it('logs spec name and error message to console.warn when spec throws', async function logsOnThrow() {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
      const evaluator = new DeterministicDomEvaluator(
        makeSpec({ name: 'broken_spec', scoreResult: 'throw' }),
      );
      await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[DeterministicDomEvaluator] spec threw during scoring:',
        { spec: 'broken_spec' },
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
  });

  describe('needsFullDocument', function fullDocTests() {
    it('passes full document HTML when spec sets needsFullDocument', async function fullDoc() {
      let capturedHtml = '';
      const spec: StructuralEvalSpec = {
        name: 'full_doc_spec',
        dimension: 'full_doc',
        description: 'Needs full document',
        comparisonMode: 'score',
        needsFullDocument: true,
        score: (html: string): StructuralScoreResult => {
          capturedHtml = html;
          return { score: 1.0, canScore: true, reason: 'ok', details: {} };
        },
      };
      const fullHtml =
        '<html><head><meta name="viewport" content="width=device-width"></head><body><p>hi</p></body></html>';
      const evaluator = new DeterministicDomEvaluator(spec);
      await evaluator.evaluate(makeTranscript(), scenario, await makeSnapshot(fullHtml));
      expect(capturedHtml).toContain('<head>');
      expect(capturedHtml).toContain('viewport');
    });

    it('responsive-readiness detects viewport meta in full document', async function responsiveViewport() {
      const evaluator = new DeterministicDomEvaluator(responsiveReadinessSpec);
      const fullHtml = [
        '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
        '<body><div class="flex sm:grid-cols-2"><p>hello</p></div></body></html>',
      ].join('');
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot(fullHtml),
      );
      expect(result.score).toBe(1.0);
      expect(result.details).toMatchObject({ hasViewport: true });
    });
  });

  describe('integration seam: comparisonMode gates verdict path', function comparisonModeSeam() {
    it('passRate spec: verdict is pass or fail, never partial; comparisonMode forwarded', async function passRateVerdict() {
      const spec: StructuralEvalSpec = {
        name: 'inv_spec',
        dimension: 'inv_dim',
        description: 'INV spec',
        comparisonMode: 'passRate',
        score: (): StructuralScoreResult => ({ score: 0.5, canScore: true, reason: 'ok', details: {} }),
        toChecklistItems: (): ChecklistItemOutcome[] => [
          { id: 'inv-check', type: 'invariance', status: 'pass', reason: 'ok' },
        ],
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      expect(evaluator.comparisonMode).toBe('passRate');
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(result.verdict).toBe('pass');
      expect(result.score).toBeCloseTo(1.0);
    });

    it('passRate spec: any invariance fail → verdict fail, score = passed/evaluable', async function passRateFail() {
      const spec: StructuralEvalSpec = {
        name: 'inv_fail_spec',
        dimension: 'inv_dim',
        description: 'INV spec with failure',
        comparisonMode: 'passRate',
        score: (): StructuralScoreResult => ({ score: 0.5, canScore: true, reason: 'ok', details: {} }),
        toChecklistItems: (): ChecklistItemOutcome[] => [
          { id: 'inv-pass', type: 'invariance', status: 'pass', reason: 'ok' },
          { id: 'inv-fail', type: 'invariance', status: 'fail', reason: 'broken' },
        ],
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(result.verdict).toBe('fail');
      expect(result.score).toBeCloseTo(0.5);
    });

    it('score spec with toChecklistItems: verdict from scoreToVerdict, not reduceChecklistOutcomes', async function scoreModeIgnoresChecklist() {
      const spec: StructuralEvalSpec = {
        name: 'dir_spec',
        dimension: 'dir_dim',
        description: 'DIR spec — has toChecklistItems but uses score path',
        comparisonMode: 'score',
        score: (): StructuralScoreResult => ({ score: 0.5, canScore: true, reason: 'mid score', details: {} }),
        toChecklistItems: (): ChecklistItemOutcome[] => [
          { id: 'dir-check', type: 'directional', status: 'fail', reason: 'bad' },
        ],
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      expect(evaluator.comparisonMode).toBe('score');
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      // scoreToVerdict(0.5) → 'fail' (below PASS_THRESHOLD)
      expect(result.verdict).toBe('fail');
      expect(result.score).toBeCloseTo(0.5);
    });

    it('passRate spec + canScore false → verdict incomplete', async function passRateCanScoreFalse() {
      const spec: StructuralEvalSpec = {
        name: 'inv_no_score',
        dimension: 'inv_dim',
        description: 'INV spec with no scoreable content',
        comparisonMode: 'passRate',
        score: (): StructuralScoreResult => ({ score: 0, canScore: false, reason: 'no content', details: {} }),
        toChecklistItems: (): ChecklistItemOutcome[] => [
          { id: 'inv-check', type: 'invariance', status: 'incomplete', reason: 'no content' },
        ],
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(result.verdict).toBe('incomplete');
    });
  });

  describe('integration seam: toChecklistItems -> details.items', function checklistSeam() {
    it('attaches details.items when spec has toChecklistItems', async function attachesItems() {
      const spec: StructuralEvalSpec = {
        name: 'checklist_spec',
        dimension: 'checklist_dim',
        description: 'A spec with checklist items',
        comparisonMode: 'score',
        score: (): StructuralScoreResult => ({ score: 1.0, canScore: true, reason: 'ok', details: {} }),
        toChecklistItems: (): ChecklistItemOutcome[] => [
          { id: 'my-check', type: 'invariance', status: 'pass', reason: 'looks good' },
        ],
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(result.details).toMatchObject({
        items: [{ id: 'my-check', type: 'invariance', status: 'pass' }],
      });
    });

    it('does not attach details.items when spec lacks toChecklistItems', async function noItems() {
      const spec: StructuralEvalSpec = {
        name: 'plain_spec',
        dimension: 'plain_dim',
        description: 'A spec without checklist items',
        comparisonMode: 'score',
        score: (): StructuralScoreResult => ({ score: 1.0, canScore: true, reason: 'ok', details: {} }),
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(result.details).not.toHaveProperty('items');
    });

    it('attaches all-incomplete items when canScore: false and spec has toChecklistItems', async function canScoreFalseItems() {
      const spec: StructuralEvalSpec = {
        name: 'checklist_no_score_spec',
        dimension: 'checklist_no_score',
        description: 'A spec with checklist items but no scoreable content',
        comparisonMode: 'score',
        score: (): StructuralScoreResult => ({
          score: 0,
          canScore: false,
          reason: 'No content to score',
          details: {},
        }),
        toChecklistItems: (): ChecklistItemOutcome[] => [
          { id: 'my-check', type: 'invariance', status: 'incomplete', reason: 'No content to evaluate' },
        ],
      };
      const evaluator = new DeterministicDomEvaluator(spec);
      const result = await evaluator.evaluate(
        makeTranscript(),
        scenario,
        await makeSnapshot('<html><body><p>content</p></body></html>'),
      );
      expect(result.verdict).toBe('incomplete');
      expect(result.details).toMatchObject({
        items: [{ id: 'my-check', status: 'incomplete' }],
      });
    });
  });
});
