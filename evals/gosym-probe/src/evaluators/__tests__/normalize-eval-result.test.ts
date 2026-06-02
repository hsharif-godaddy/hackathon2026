import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeEvalResult } from '../normalize-eval-result.js';
import type { EvalResult } from '../evaluator.js';

function makeResult(
  overrides: Partial<EvalResult> = {},
): EvalResult {
  return {
    evaluator: 'test-eval',
    score: 0.75,
    verdict: 'pass',
    reason: 'All checks passed',
    ...overrides,
  };
}

describe('normalizeEvalResult', () => {
  it('passes through a valid result unchanged', () => {
    const input = makeResult();
    const output = normalizeEvalResult(input);
    expect(output).toEqual(input);
  });

  it('preserves details when present', () => {
    const details = { errorCount: 2, errors: ['a', 'b'] };
    const output = normalizeEvalResult(makeResult({ details }));
    expect(output.details).toEqual(details);
  });

  it('omits details when undefined', () => {
    const output = normalizeEvalResult(makeResult());
    expect(output).not.toHaveProperty('details');
  });

  describe('score normalization', () => {
    it('coerces NaN to 0', () => {
      const output = normalizeEvalResult(makeResult({ score: NaN }));
      expect(output.score).toBe(0);
    });

    it('coerces Infinity to 0 (non-finite fallback)', () => {
      const output = normalizeEvalResult(
        makeResult({ score: Infinity }),
      );
      expect(output.score).toBe(0);
    });

    it('coerces -Infinity to 0', () => {
      const output = normalizeEvalResult(
        makeResult({ score: -Infinity }),
      );
      expect(output.score).toBe(0);
    });

    it('clamps negative score to 0', () => {
      const output = normalizeEvalResult(
        makeResult({ score: -0.5 }),
      );
      expect(output.score).toBe(0);
    });

    it('clamps score above 1 to 1', () => {
      const output = normalizeEvalResult(
        makeResult({ score: 2.5 }),
      );
      expect(output.score).toBe(1);
    });

    it('preserves valid score in [0, 1]', () => {
      const output = normalizeEvalResult(
        makeResult({ score: 0.42 }),
      );
      expect(output.score).toBe(0.42);
    });

    it('preserves boundary values 0 and 1', () => {
      expect(
        normalizeEvalResult(makeResult({ score: 0 })).score,
      ).toBe(0);
      expect(
        normalizeEvalResult(makeResult({ score: 1 })).score,
      ).toBe(1);
    });
  });

  describe('reason normalization', () => {
    it('coerces null to empty string', () => {
      const output = normalizeEvalResult(
        makeResult({ reason: null as unknown as string }),
      );
      expect(output.reason).toBe('');
    });

    it('coerces undefined to empty string', () => {
      const output = normalizeEvalResult(
        makeResult({ reason: undefined as unknown as string }),
      );
      expect(output.reason).toBe('');
    });

    it('flattens newlines to single spaces', () => {
      const output = normalizeEvalResult(
        makeResult({ reason: 'line1\nline2\nline3' }),
      );
      expect(output.reason).toBe('line1 line2 line3');
    });

    it('flattens carriage-return-newline sequences', () => {
      const output = normalizeEvalResult(
        makeResult({ reason: 'line1\r\nline2\r\nline3' }),
      );
      expect(output.reason).toBe('line1 line2 line3');
    });

    it('collapses consecutive newlines into one space', () => {
      const output = normalizeEvalResult(
        makeResult({ reason: 'a\n\n\nb' }),
      );
      expect(output.reason).toBe('a b');
    });

    it('trims leading and trailing whitespace', () => {
      const output = normalizeEvalResult(
        makeResult({ reason: '  spaced  ' }),
      );
      expect(output.reason).toBe('spaced');
    });

    it('preserves a valid single-line reason', () => {
      const output = normalizeEvalResult(
        makeResult({ reason: 'All checks passed' }),
      );
      expect(output.reason).toBe('All checks passed');
    });

    it('coerces non-string value to empty string', () => {
      const output = normalizeEvalResult(
        makeResult({ reason: 42 as unknown as string }),
      );
      expect(output.reason).toBe('');
    });
  });

  describe('verdict normalization', () => {
    const validVerdicts = [
      'pass', 'partial', 'fail', 'unknown', 'observed',
    ] as const;

    for (const v of validVerdicts) {
      it(`preserves valid verdict '${v}'`, () => {
        const output = normalizeEvalResult(
          makeResult({ verdict: v }),
        );
        expect(output.verdict).toBe(v);
      });
    }

    it('coerces invalid verdict to unknown', () => {
      const output = normalizeEvalResult(
        makeResult({
          verdict: 'invalid' as unknown as EvalResult['verdict'],
        }),
      );
      expect(output.verdict).toBe('unknown');
    });

    it('coerces null verdict to unknown', () => {
      const output = normalizeEvalResult(
        makeResult({
          verdict: null as unknown as EvalResult['verdict'],
        }),
      );
      expect(output.verdict).toBe('unknown');
    });
  });

  describe('evaluator name normalization', () => {
    it('preserves valid evaluator name', () => {
      const output = normalizeEvalResult(
        makeResult({ evaluator: 'output-quality' }),
      );
      expect(output.evaluator).toBe('output-quality');
    });

    it('defaults empty evaluator name to unknown', () => {
      const output = normalizeEvalResult(
        makeResult({ evaluator: '' }),
      );
      expect(output.evaluator).toBe('unknown');
    });

    it('defaults null evaluator name to unknown', () => {
      const output = normalizeEvalResult(
        makeResult({
          evaluator: null as unknown as string,
        }),
      );
      expect(output.evaluator).toBe('unknown');
    });
  });

  describe('score-mode evaluator integration', () => {
    it('passes through a typical LatencyEvaluator-shaped result unchanged', () => {
      const details = { medianTTFC: 1200, halfLifeMs: 2000 };
      const input = makeResult({
        verdict: 'observed' as EvalResult['verdict'],
        score: 0.75,
        reason: 'Median TTFC within half-life',
        details,
      });
      const output = normalizeEvalResult(input);
      expect(output.verdict).toBe('observed');
      expect(output.score).toBe(0.75);
      expect(output.reason).toBe('Median TTFC within half-life');
      expect(output.details).toEqual(details);
    });

    it('preserves boundary score 0 with observed verdict', () => {
      const output = normalizeEvalResult(
        makeResult({ verdict: 'observed' as EvalResult['verdict'], score: 0 }),
      );
      expect(output.score).toBe(0);
      expect(output.verdict).toBe('observed');
    });

    it('preserves boundary score 1 with observed verdict', () => {
      const output = normalizeEvalResult(
        makeResult({ verdict: 'observed' as EvalResult['verdict'], score: 1 }),
      );
      expect(output.score).toBe(1);
      expect(output.verdict).toBe('observed');
    });

    it('passes through score > 1 unclamped for observed verdict', () => {
      const output = normalizeEvalResult(
        makeResult({ verdict: 'observed' as EvalResult['verdict'], score: 7500 }),
      );
      expect(output.score).toBe(7500);
      expect(output.verdict).toBe('observed');
    });

    it('passes through score 1.5 unclamped for observed verdict', () => {
      const output = normalizeEvalResult(
        makeResult({ verdict: 'observed' as EvalResult['verdict'], score: 1.5 }),
      );
      expect(output.score).toBe(1.5);
      expect(output.verdict).toBe('observed');
    });

    it('coerces NaN to 0 even for observed verdict', () => {
      const output = normalizeEvalResult(
        makeResult({ verdict: 'observed' as EvalResult['verdict'], score: NaN }),
      );
      expect(output.score).toBe(0);
      expect(output.verdict).toBe('observed');
    });

    it('coerces Infinity to 0 even for observed verdict', () => {
      const output = normalizeEvalResult(
        makeResult({ verdict: 'observed' as EvalResult['verdict'], score: Infinity }),
      );
      expect(output.score).toBe(0);
      expect(output.verdict).toBe('observed');
    });
  });

  it('preserves evaluatorFailed when true', () => {
    const output = normalizeEvalResult(
      makeResult({ evaluatorFailed: true }),
    );
    expect(output.evaluatorFailed).toBe(true);
  });

  it('omits evaluatorFailed when undefined', () => {
    const output = normalizeEvalResult(makeResult());
    expect(output).not.toHaveProperty('evaluatorFailed');
  });

  it('returns a new object (no mutation)', () => {
    const input = makeResult();
    const output = normalizeEvalResult(input);
    expect(output).not.toBe(input);
  });

  it('does not warn for a fully valid result', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    normalizeEvalResult(makeResult());
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('normalizeEvalResult — console.warn on fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns when verdict is invalid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    normalizeEvalResult(
      makeResult({ verdict: 'yes' as unknown as EvalResult['verdict'] }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('verdict'),
      expect.anything(),
    );
  });

  it('warns when evaluator name is empty', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    normalizeEvalResult(makeResult({ evaluator: '' }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('evaluator'),
      expect.anything(),
    );
  });

  it('warns when evaluator name is null', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    normalizeEvalResult(
      makeResult({ evaluator: null as unknown as string }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('evaluator'),
      expect.anything(),
    );
  });
});
