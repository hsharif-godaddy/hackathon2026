import type { ComparedRegressionEvalResult, RegressionEvalResult, RegressionResult } from '../baselines/types.js';

export function formatCompactNumber(x: number): string {
  if (!Number.isFinite(x)) return 'N/A';
  const sign = x >= 0 ? '+' : '-';
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

export type EvaluatorSignal = 'confirmed' | 'inconclusive' | 'underpowered';

/**
 * Classifies an exceeded evaluator's signal:
 * - 'confirmed'     — the observed delta clears the CI half-width (real signal).
 * - 'underpowered'  — not confirmed, and achieved power is below target: the
 *                     run is too thin to resolve the effect (more trials needed,
 *                     not necessarily a regression).
 * - 'inconclusive'  — not confirmed, with no power data to say it's underpowered.
 */
export function classifyEvaluatorSignal(
  e: ComparedRegressionEvalResult,
): EvaluatorSignal {
  if (!e.statistical) return 'inconclusive';
  // A non-finite delta means the effect itself is unmeasurable, so achieved
  // power on it is meaningless — never label this 'underpowered' (the closing
  // copy reports "delta could not be computed", which must agree with it).
  if (!Number.isFinite(e.delta)) return 'inconclusive';
  const { lower, upper } = e.statistical.confidenceInterval;
  if (upper === lower) return underpoweredOrInconclusive(e);
  const ciHalfWidth = (upper - lower) / 2;
  if (Math.abs(e.delta) > ciHalfWidth) return 'confirmed';
  return underpoweredOrInconclusive(e);
}

/**
 * Refines a not-confirmed signal: 'underpowered' when power data shows achieved
 * power below target (too few trials to resolve the effect), else 'inconclusive'.
 */
function underpoweredOrInconclusive(
  e: ComparedRegressionEvalResult,
): EvaluatorSignal {
  const power = e.statistical?.power;
  if (power && power.achievedPower < power.targetPower) return 'underpowered';
  return 'inconclusive';
}

function isExceededWithStats(e: RegressionEvalResult): e is ComparedRegressionEvalResult {
  if (e.type !== 'compared') return false;
  return e.exceeded && e.statistical !== undefined;
}

function formatEvaluatorBlock(
  e: ComparedRegressionEvalResult,
  signal: EvaluatorSignal,
): string {
  const delta = formatCompactNumber(e.delta);
  // statistical is guaranteed present by isExceededWithStats filter
  const { lower, upper } = e.statistical!.confidenceInterval;
  const n = e.statistical!.n.current;
  const ciLower = formatCompactNumber(lower);
  const ciUpper = formatCompactNumber(upper);
  const powerNote =
    signal === 'underpowered' && e.statistical!.power
      ? ` (power ${(e.statistical!.power.achievedPower * 100).toFixed(0)}% < `
        + `${(e.statistical!.power.targetPower * 100).toFixed(0)}% target)`
      : '';
  return [
    `  ${e.evaluator}:`,
    `    Δ=${delta}, CI=[${ciLower}, ${ciUpper}], n=${n}`,
    `    [${signal}]${powerNote}`,
  ].join('\n');
}

/**
 * Returns a warning message when the gate passes but one or more evaluators
 * had their margin floored (baseline SD was near-zero). This indicates the
 * baseline is fragile and the pass was rescued by the relative floor (frac·mean).
 */
export function formatMarginFloorWarning(r: RegressionResult): string | null {
  if (r.gate === 'fail') return null;

  const flooredEvals = r.evaluators.filter(
    (e): e is ComparedRegressionEvalResult =>
      e.type === 'compared' &&
      e.statistical?.marginFloored === true &&
      !e.exceeded,
  );

  if (flooredEvals.length === 0) return null;

  const evalLines = flooredEvals.map((e) => {
    const margin = e.statistical!.margin.toFixed(3);
    const sd = e.statistical!.baselineSD.toFixed(4);
    return `  ${e.evaluator}: baseline SD=${sd}, margin floored to ${margin}`;
  });

  return [
    `Pass (margin-floored): "${r.scenarioName}"`,
    ...evalLines,
    '  Consider graduating with more trials for a tighter baseline.',
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
  const underpoweredCount = classified.filter((c) => c.signal === 'underpowered').length;
  const inconclusiveCount = classified.filter((c) => c.signal === 'inconclusive').length;
  // Underpowered and inconclusive both mean "not confirmed"; group them for the
  // gate summary, but call out underpowered explicitly so the fix reads as
  // "more trials" rather than "investigate a regression".
  const unconfirmedCount = underpoweredCount + inconclusiveCount;

  let signalSummary: string;
  if (confirmedCount === 0) {
    signalSummary = underpoweredCount > 0
      ? 'underpowered — too few trials to resolve'
      : 'statistical test inconclusive';
  } else if (unconfirmedCount === 0) {
    signalSummary = 'statistical evidence of regression';
  } else {
    const tail = underpoweredCount > 0
      ? `${unconfirmedCount} unconfirmed (${underpoweredCount} underpowered)`
      : `${inconclusiveCount} inconclusive`;
    signalSummary = `${confirmedCount} confirmed, ${tail}`;
  }

  const header = `Regression: "${r.scenarioName}" — ${signalSummary}:`;
  const evaluatorBlocks = classified.map(({ e, signal }) => formatEvaluatorBlock(e, signal));

  let closing: string;
  if (confirmedCount > 0 && unconfirmedCount === 0) {
    closing = 'Investigate the change before running more trials.';
  } else if (confirmedCount > 0) {
    const plural = confirmedCount > 1 ? 'regressions' : 'regression';
    closing = `Investigate confirmed ${plural}; run more trials for the unconfirmed evaluators:\n  pnpm run eval --scenario ${r.scenarioName} --trials 5`;
  } else {
    const hasNaN = exceeded.some((e) => !Number.isFinite(e.delta));
    closing = hasNaN
      ? 'Investigation recommended — delta could not be computed.'
      : `Run more trials to determine if this is noise or a regression:\n  pnpm run eval --scenario ${r.scenarioName} --trials 5`;
  }

  return [header, ...evaluatorBlocks, '', closing].join('\n');
}
