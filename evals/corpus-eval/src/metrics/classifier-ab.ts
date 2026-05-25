import type { CaseResult, ClassifierAbSummary } from '../corpus/types.js';

function lrMatchesExpected(r: CaseResult): boolean {
  const c = r.classifierComparison;
  if (!c) return false;
  return c.lr.taskType === r.expected.taskType;
}

function nnMatchesExpected(r: CaseResult): boolean {
  const c = r.classifierComparison;
  if (!c) return false;
  return c.nn.taskType === r.expected.taskType;
}

/**
 * Aggregate LR vs embedding (NN) shadow metrics from per-case results.
 */
export function calculateClassifierAbSummary(results: CaseResult[]): ClassifierAbSummary {
  const shadow = results.filter((r) => r.classifierComparison != null);
  const n = shadow.length;
  if (n === 0) {
    return {
      casesWithShadow: 0,
      agreeCount: 0,
      disagreeCount: 0,
      agreeRatio: 0,
      disagreeRatio: 0,
      lrMatchesGoldNnWrongCount: 0,
      lrMatchesGoldNnWrongRatio: 0,
      nnHaikuLrConfidentSetupCount: 0,
      nnHaikuLrConfidentFastPathGoldCount: 0,
      nnHaikuLrConfidentFastPathGoldRatio: 0,
    };
  }

  let agreeCount = 0;
  let lrMatchesGoldNnWrongCount = 0;
  let nnHaikuLrConfidentSetupCount = 0;
  let nnHaikuLrConfidentFastPathGoldCount = 0;

  for (const r of shadow) {
    const c = r.classifierComparison!;
    if (c.agree) agreeCount += 1;
    if (lrMatchesExpected(r) && !nnMatchesExpected(r)) lrMatchesGoldNnWrongCount += 1;
    if (c.nn.requiresHaikuVerification && !c.lr.requiresHaikuVerification) {
      nnHaikuLrConfidentSetupCount += 1;
      if (r.actual.path === 'embedding' && c.lr.taskType === r.expected.taskType) {
        nnHaikuLrConfidentFastPathGoldCount += 1;
      }
    }
  }

  const disagreeCount = n - agreeCount;

  return {
    casesWithShadow: n,
    agreeCount,
    disagreeCount,
    agreeRatio: agreeCount / n,
    disagreeRatio: disagreeCount / n,
    lrMatchesGoldNnWrongCount,
    lrMatchesGoldNnWrongRatio: lrMatchesGoldNnWrongCount / n,
    nnHaikuLrConfidentSetupCount,
    nnHaikuLrConfidentFastPathGoldCount,
    nnHaikuLrConfidentFastPathGoldRatio:
      nnHaikuLrConfidentSetupCount > 0
        ? nnHaikuLrConfidentFastPathGoldCount / nnHaikuLrConfidentSetupCount
        : 0,
  };
}
