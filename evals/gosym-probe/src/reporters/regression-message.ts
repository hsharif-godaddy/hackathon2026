import type { ComparedRegressionEvalResult, RegressionEvalResult, RegressionResult } from '../baselines/types.js';

export function formatCompactNumber(x: number): string {
  if (!Number.isFinite(x)) return 'N/A';
  const sign = x >= 0 ? '+' : '-';
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

export function classifyEvaluatorSignal(
  e: ComparedRegressionEvalResult,
): 'confirmed' | 'inconclusive' {
  if (!e.statistical) return 'inconclusive';
  if (!Number.isFinite(e.delta)) return 'inconclusive';
  const { lower, upper } = e.statistical.confidenceInterval;
  if (upper === lower) return 'inconclusive';
  const ciHalfWidth = (upper - lower) / 2;
  return Math.abs(e.delta) > ciHalfWidth ? 'confirmed' : 'inconclusive';
}

function isExceededWithStats(e: RegressionEvalResult): e is ComparedRegressionEvalResult {
  if (e.type !== 'compared') return false;
  return e.exceeded && e.statistical !== undefined;
}

function formatEvaluatorBlock(
  e: ComparedRegressionEvalResult,
  signal: 'confirmed' | 'inconclusive',
): string {
  const delta = formatCompactNumber(e.delta);
  // statistical is guaranteed present by isExceededWithStats filter
  const { lower, upper } = e.statistical!.confidenceInterval;
  const n = e.statistical!.n.current;
  const ciLower = formatCompactNumber(lower);
  const ciUpper = formatCompactNumber(upper);
  return [
    `  ${e.evaluator}:`,
    `    Δ=${delta}, CI=[${ciLower}, ${ciUpper}], n=${n}`,
    `    [${signal}]`,
  ].join('\n');
}

export function formatRegressionFailureMessage(r: RegressionResult): string | null {
  const exceeded = r.evaluators.filter(isExceededWithStats);
  if (exceeded.length === 0) return null;

  const classified = exceeded.map((e) => ({
    e,
    signal: classifyEvaluatorSignal(e),
  }));

  const confirmedCount = classified.filter((c) => c.signal === 'confirmed').length;
  const inconclusiveCount = classified.filter((c) => c.signal === 'inconclusive').length;

  let signalSummary: string;
  if (confirmedCount === 0) {
    signalSummary = 'statistical test inconclusive';
  } else if (inconclusiveCount === 0) {
    signalSummary = 'statistical evidence of regression';
  } else {
    signalSummary = `${confirmedCount} confirmed, ${inconclusiveCount} inconclusive`;
  }

  const header = `Regression: "${r.scenarioName}" — ${signalSummary}:`;
  const evaluatorBlocks = classified.map(({ e, signal }) => formatEvaluatorBlock(e, signal));

  let closing: string;
  if (confirmedCount > 0 && inconclusiveCount === 0) {
    closing = 'Investigate the change before running more trials.';
  } else if (confirmedCount > 0) {
    const plural = confirmedCount > 1 ? 'regressions' : 'regression';
    closing = `Investigate confirmed ${plural}; run more trials for inconclusive evaluators:\n  pnpm run eval --scenario ${r.scenarioName} --trials 5`;
  } else {
    const hasNaN = exceeded.some((e) => !Number.isFinite(e.delta));
    closing = hasNaN
      ? 'Investigation recommended — delta could not be computed.'
      : `Run more trials to determine if this is noise or a regression:\n  pnpm run eval --scenario ${r.scenarioName} --trials 5`;
  }

  return [header, ...evaluatorBlocks, '', closing].join('\n');
}
