import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootstrapMAE, bootstrapBias, isSignificantBias } from './bootstrap.js';
import { computeICC, interpretICC, bootstrapICC } from './icc.js';

type Stats = { variance?: number | null; stddev?: number | null; range?: number | null };

type Consensus = {
  evaluatorId: string;
  scale?: { min?: number; max?: number };
  scoreType?: string;
  judges?: Array<{
    judgeId?: string;
    model?: string;
    valid?: boolean;
    rawScore?: number | null;  // Before bias correction
    score?: number | null;     // After bias correction (primary)
  }>;
  metrics?: {
    judgeAgreement?: { exact?: boolean; withinThreshold?: boolean; computable?: boolean };
    metaJudgeOverride?: { override?: boolean };
    scoreVariance?: Stats | { raw?: Stats; corrected?: Stats; normalized?: Stats };
    scoreVarianceNormalized?: Stats;
    confidence?: {
      judges?: { mean?: number | null; n?: number };
      meta?: number | null;
    };
    validity?: { nValid?: number; nTotal?: number };
    vsProduction?: { productionScore?: number | null; delta?: number | null; absDelta?: number | null };
  };
};

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function listDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)).sort();
}

function bin(conf: number): number {
  if (conf <= 0) return 0;
  if (conf >= 1) return 9;
  return Math.min(9, Math.max(0, Math.floor(conf * 10)));
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return (num / den) * 100;
}

function pushNum(arr: number[], v: unknown): void {
  if (typeof v === 'number' && Number.isFinite(v)) arr.push(v);
}

function emptyAgg() {
  return {
    runs: 0,
    // Agreement is only counted over runs where it is computable (≥2 valid judges).
    agreementComputable: 0,
    insufficientJudges: 0,
    judgeAgreementExact: 0,
    judgeAgreementWithin: 0,
    metaOverride: 0,
    // Raw (per-evaluator scale) and normalized ([0,1], cross-evaluator comparable) variance.
    variancesNorm: [] as number[],
    stddevsNorm: [] as number[],
    rangesNorm: [] as number[],
    variancesRaw: [] as number[],
    variancesCorrected: [] as number[],  // After bias correction
    // Calibration vs production ground truth.
    absDeltasRaw: [] as number[],
    signedDeltasRaw: [] as number[],
    normAbsDeltas: [] as number[],
    vsProdWithin: 0,
    vsProdN: 0,
    judgeConfBins: Array.from({ length: 10 }, () => 0),
    metaConfBins: Array.from({ length: 10 }, () => 0),
    judgeConfCount: 0,
    metaConfCount: 0,
    // ICC computation: collect raw and corrected score arrays
    validScoreArraysRaw: [] as number[][],      // Before bias correction
    validScoreArraysCorrected: [] as number[][], // After bias correction (primary)
  };
}

function avg(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function summarize(agg: ReturnType<typeof emptyAgg>) {
  // Bootstrap CIs for production comparison metrics
  const maeCI = bootstrapMAE(agg.absDeltasRaw, 0.95, 10000);
  const biasCI = bootstrapBias(agg.signedDeltasRaw, 0.95, 10000);
  const biasSignificant = isSignificantBias(biasCI);

  // Sample size warnings
  const insufficientData = agg.vsProdN < 10;
  const ciWidthNormalized = maeCI ? (maeCI.upper - maeCI.lower) / 100 : null; // Assuming 0-100 scale

  // ICC (Intraclass Correlation Coefficient) for inter-rater reliability
  // Compute on BOTH raw (before bias correction) and corrected (after) to show natural vs coached agreement
  const iccRaw = computeICC(agg.validScoreArraysRaw);
  const iccCorrected = computeICC(agg.validScoreArraysCorrected);
  const iccCI = bootstrapICC(agg.validScoreArraysCorrected, 0.95, 2000);

  const iccResult = iccCorrected !== null
    ? {
        value: iccCorrected,
        interpretation: interpretICC(iccCorrected),
        n: agg.validScoreArraysCorrected.length,
        ci: iccCI ? { lower: iccCI.lower, upper: iccCI.upper, confidence: 0.95 } : null,
        reliable: iccCI?.reliable ?? false,
        warning: iccCI && !iccCI.reliable
          ? `ICC estimates are unstable at n=${agg.validScoreArraysCorrected.length} (recommend n≥30). Interpretation brackets (Poor/Moderate/Good/Excellent) derived for larger studies may not apply. The 95% CI spans ${iccCI ? `[${iccCI.lower.toFixed(2)}, ${iccCI.upper.toFixed(2)}]` : 'unknown range'}.`
          : null,
        description: 'ICC(2,1) on bias-corrected scores: Two-way random effects, single rater. Primary reliability metric.',
        rawVsCorrected: iccRaw !== null
          ? {
              rawICC: iccRaw,
              correctedICC: iccCorrected,
              note: 'Raw ICC measures natural model consensus. Corrected ICC measures agreement after post-hoc bias mitigation. If corrected > raw, bias correction improved panel coherence.',
            }
          : null,
      }
    : null;

  return {
    runs: agg.runs,
    judgeAgreementPct: {
      // Denominator is computable runs, so "couldn't measure" is not counted as "disagreed".
      basis: 'computable_runs',
      computableRuns: agg.agreementComputable,
      insufficientJudges: agg.insufficientJudges,
      exact: pct(agg.judgeAgreementExact, agg.agreementComputable),
      withinThreshold: pct(agg.judgeAgreementWithin, agg.agreementComputable),
      // ICC as primary reliability metric
      icc: iccResult,
    },
    metaJudgeOverrideRatePct: pct(agg.metaOverride, agg.runs),
    scoreVariance: {
      // Normalized is the cross-evaluator-comparable figure; raw kept for single-evaluator context.
      avgVarianceNormalized: avg(agg.variancesNorm),
      avgStdDevNormalized: avg(agg.stddevsNorm),
      avgRangeNormalized: avg(agg.rangesNorm),
      avgVarianceRaw: avg(agg.variancesRaw),
      avgVarianceCorrected: avg(agg.variancesCorrected),
      note: 'Raw variance computed on model outputs before bias correction. Corrected variance computed after bias correction (used for finalScore).',
    },
    vsProduction: {
      n: agg.vsProdN,
      meanAbsDeltaRaw: avg(agg.absDeltasRaw),
      meanAbsDeltaCI: maeCI
        ? { lower: maeCI.lower, upper: maeCI.upper, confidence: 0.95 }
        : null,
      biasRaw: avg(agg.signedDeltasRaw),
      biasCI: biasCI
        ? { lower: biasCI.lower, upper: biasCI.upper, confidence: 0.95 }
        : null,
      biasSignificant,
      meanAbsDeltaNormalized: avg(agg.normAbsDeltas),
      withinScalePct: pct(agg.vsProdWithin, agg.vsProdN),
      // Reliability qualifiers
      insufficientData,
      ciWidthNormalized,
      warning: insufficientData
        ? `Insufficient data: n=${agg.vsProdN} (recommend n≥20 for confident decisions)`
        : null,
    },
    confidenceDistribution: {
      judges: { bins: agg.judgeConfBins, n: agg.judgeConfCount },
      meta: { bins: agg.metaConfBins, n: agg.metaConfCount },
      calibration: {
        validated: false,
        warning: 'Self-reported confidence is informational only. Not validated against accuracy.',
      },
    },
  };
}

const WITHIN_SCALE_FRACTION = 0.1; // |finalScore − production| within 10% of the scale range

export async function aggregateJudgingMetrics(params: { datasetDir: string }): Promise<unknown> {
  const simDirs = await listDirs(params.datasetDir).catch(() => []);
  const overall = emptyAgg();
  const byEvaluator = new Map<string, ReturnType<typeof emptyAgg>>();

  for (const simDir of simDirs) {
    const judgingDir = path.join(simDir, 'judging');
    const evaluatorDirs = await listDirs(judgingDir).catch(() => []);
    for (const evDir of evaluatorDirs) {
      const consensusPath = path.join(evDir, 'consensus.json');
      const raw = await readJson(consensusPath).catch(() => null);
      if (!raw || !isObject(raw)) continue;
      const c = raw as unknown as Consensus;
      if (!c.evaluatorId) continue;

      const agg = byEvaluator.get(c.evaluatorId) ?? emptyAgg();
      const accumulate = (a: ReturnType<typeof emptyAgg>): void => {
        a.runs += 1;

        const computable = c.metrics?.judgeAgreement?.computable === true;
        if (computable) {
          a.agreementComputable += 1;
          if (c.metrics?.judgeAgreement?.exact) a.judgeAgreementExact += 1;
          if (c.metrics?.judgeAgreement?.withinThreshold) a.judgeAgreementWithin += 1;
        } else {
          a.insufficientJudges += 1;
        }

        if (c.metrics?.metaJudgeOverride?.override) a.metaOverride += 1;

        // Handle both old (flat) and new (nested) scoreVariance structure
        const variance = c.metrics?.scoreVariance;
        if (variance && typeof variance === 'object') {
          if ('raw' in variance && isObject(variance.raw)) {
            pushNum(a.variancesRaw, variance.raw.variance);
          } else if ('variance' in variance) {
            pushNum(a.variancesRaw, variance.variance);
          }
          if ('corrected' in variance && isObject(variance.corrected)) {
            pushNum(a.variancesCorrected, variance.corrected.variance);
          }
          if ('normalized' in variance && isObject(variance.normalized)) {
            pushNum(a.variancesNorm, variance.normalized.variance);
            pushNum(a.stddevsNorm, variance.normalized.stddev);
            pushNum(a.rangesNorm, variance.normalized.range);
          }
        }

        // Legacy format fallback
        pushNum(a.variancesNorm, c.metrics?.scoreVarianceNormalized?.variance);
        pushNum(a.stddevsNorm, c.metrics?.scoreVarianceNormalized?.stddev);
        pushNum(a.rangesNorm, c.metrics?.scoreVarianceNormalized?.range);

        const absDelta = c.metrics?.vsProduction?.absDelta;
        const delta = c.metrics?.vsProduction?.delta;
        if (typeof absDelta === 'number' && Number.isFinite(absDelta)) {
          a.vsProdN += 1;
          a.absDeltasRaw.push(absDelta);
          pushNum(a.signedDeltasRaw, delta);
          const min = c.scale?.min ?? 0;
          const max = c.scale?.max ?? 100;
          const span = max - min > 0 ? max - min : 100;
          const normAbs = absDelta / span;
          a.normAbsDeltas.push(normAbs);
          if (normAbs <= WITHIN_SCALE_FRACTION) a.vsProdWithin += 1;
        }

        const judgeConf = c.metrics?.confidence?.judges?.mean;
        if (typeof judgeConf === 'number' && Number.isFinite(judgeConf)) {
          a.judgeConfBins[bin(judgeConf)] += 1;
          a.judgeConfCount += 1;
        }
        const metaConf = c.metrics?.confidence?.meta;
        if (typeof metaConf === 'number' && Number.isFinite(metaConf)) {
          a.metaConfBins[bin(metaConf)] += 1;
          a.metaConfCount += 1;
        }

        // Collect valid scores for ICC computation (numeric evaluators only)
        // Collect BOTH raw (before bias correction) and corrected (after) scores
        const isNumeric = (c.scoreType ?? 'NUMERIC').toUpperCase() === 'NUMERIC';
        if (isNumeric && Array.isArray(c.judges)) {
          const validScoresRaw = c.judges
            .filter((j) => j.valid === true && typeof j.rawScore === 'number')
            .map((j) => j.rawScore!);
          const validScoresCorrected = c.judges
            .filter((j) => j.valid === true && typeof j.score === 'number')
            .map((j) => j.score!);

          // If rawScore is missing (legacy format), fall back to score for raw ICC
          const rawForICC = validScoresRaw.length >= 2 ? validScoresRaw : validScoresCorrected;

          if (rawForICC.length >= 2) {
            a.validScoreArraysRaw.push(rawForICC);
          }
          if (validScoresCorrected.length >= 2) {
            a.validScoreArraysCorrected.push(validScoresCorrected);
          }
        }
      };

      accumulate(agg);
      accumulate(overall);
      byEvaluator.set(c.evaluatorId, agg);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    datasetDir: params.datasetDir,
    overall: summarize(overall),
    byEvaluatorId: Object.fromEntries(
      Array.from(byEvaluator.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, agg]) => [id, summarize(agg)]),
    ),
  };
}

export async function writeJudgingMetrics(params: { datasetDir: string }): Promise<void> {
  const out = await aggregateJudgingMetrics({ datasetDir: params.datasetDir });
  await mkdir(params.datasetDir, { recursive: true });
  await writeFile(path.join(params.datasetDir, 'judging-metrics.json'), `${JSON.stringify(out, null, 2)}\n`);
}
