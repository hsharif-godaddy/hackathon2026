import process from 'node:process';
import { parseArgs } from 'node:util';
import { EvalStore } from './store/eval-store.js';
import { extractAllTrialScores } from './baselines/trial-scores.js';
import type { TrialResult } from './runner/types.js';

/**
 * prompt-tax-compare — co-run Welch t-test for the prompt-tax experiment.
 *
 * Unlike the regression comparator (TOST non-inferiority vs a saved baseline),
 * this compares every treatment arm against an IN-RUN control, on raw per-trial
 * scores, with a two-sample Welch t-test. It exists because:
 *   1. The prompt-tax arms are sibling scenarios in ONE run, so control + every
 *      treatment share machine/time/build — confounds the compression experiment
 *      (two separate runs) could not control for.
 *   2. The compression experiment nearly shipped a phantom "9-15% regression"
 *      from comparing a stored *trimmed* mean against a fresh *raw* mean. Welch on
 *      raw per-trial arrays is the methodology that caught it.
 *
 * Usage:
 *   pnpm run prompt-tax-compare <run-id> [--task <id>] [--control <arm>]
 *
 * Defaults: task=portfolio, control=control (scenario pt-<task>-<control>).
 */

const SIGNIFICANCE_T = 2.0;

interface ArmScores {
  scenarioName: string;
  arm: string;
  trialCount: number;
  /** evaluator name -> raw per-trial scores. */
  scoresByEvaluator: Map<string, number[]>;
}

interface WelchStat {
  meanControl: number;
  meanArm: number;
  deltaPct: number;
  t: number;
  significant: boolean;
  nControl: number;
  nArm: number;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Sample standard deviation (n-1). Returns 0 for fewer than 2 values. */
function sampleSD(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance =
    xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Two-sample Welch t-statistic (unequal variances): comparing the treatment arm
 * against the control. A |t| above SIGNIFICANCE_T is flagged significant — the
 * same threshold the compression writeup used. Returns t=NaN when either arm has
 * insufficient data or both arms have zero variance (no signal to test).
 */
function welch(control: readonly number[], arm: readonly number[]): WelchStat {
  const meanControl = mean(control);
  const meanArm = mean(arm);
  const sdC = sampleSD(control);
  const sdA = sampleSD(arm);
  const nC = control.length;
  const nA = arm.length;

  const deltaPct =
    Number.isFinite(meanControl) && meanControl !== 0
      ? ((meanArm - meanControl) / meanControl) * 100
      : NaN;

  const se = Math.sqrt((sdC * sdC) / nC + (sdA * sdA) / nA);
  const t = se > 0 ? (meanArm - meanControl) / se : NaN;

  return {
    meanControl,
    meanArm,
    deltaPct,
    t,
    significant: Number.isFinite(t) && Math.abs(t) > SIGNIFICANCE_T,
    nControl: nC,
    nArm: nA,
  };
}

async function loadArmScores(
  evalStore: EvalStore,
  dirName: string,
  scenarioName: string,
): Promise<ArmScores | null> {
  const trialIndices = await evalStore.listCompletedTrialIndices(
    dirName,
    scenarioName,
  );
  if (trialIndices.length === 0) return null;

  const trials: TrialResult[] = [];
  for (const idx of trialIndices) {
    const trial = await evalStore.loadTrialResultByDirName(
      dirName,
      scenarioName,
      idx,
    );
    if (trial) trials.push(trial);
  }
  if (trials.length === 0) return null;

  const arm = scenarioName.replace(/^pt-[^-]+-/, '');
  return {
    scenarioName,
    arm,
    trialCount: trials.length,
    scoresByEvaluator: extractAllTrialScores(trials),
  };
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function renderReport(
  runId: string,
  control: ArmScores,
  treatments: ArmScores[],
): string {
  const lines: string[] = [];
  lines.push(`# prompt-tax co-run comparison — \`${runId}\``);
  lines.push('');
  lines.push(
    `Welch t-test of each arm vs **${control.scenarioName}** ` +
      `(in-run control, n=${control.trialCount}). ` +
      `Raw per-trial scores. Significant when \`|t| > ${SIGNIFICANCE_T}\`.`,
  );
  lines.push('');
  lines.push(
    `> _The \`|t| > ${SIGNIFICANCE_T}\` cutoff is a large-df approximation ` +
      `(at n≈20 the two-tailed α=0.05 critical value is ~2.02); an arm that ` +
      `completes with far fewer trials would be under-thresholded. This report ` +
      `is a screening view — the significance verdict of record is the ` +
      `FDR-corrected analysis in the experiment writeups, not this table._`,
  );
  lines.push('');

  // Union of evaluators present on the control, in a stable order.
  const evaluatorNames = [...control.scoresByEvaluator.keys()].sort();

  for (const treatment of treatments) {
    lines.push(`## ${treatment.arm}  (\`${treatment.scenarioName}\`, n=${treatment.trialCount})`);
    lines.push('');
    lines.push(
      '| Metric | Control µ | Arm µ | Δ% | Welch t | Significant (|t|>2)? |',
    );
    lines.push('|---|---|---|---|---|---|');
    for (const evalName of evaluatorNames) {
      const controlScores = control.scoresByEvaluator.get(evalName) ?? [];
      const armScores = treatment.scoresByEvaluator.get(evalName) ?? [];
      if (controlScores.length === 0 && armScores.length === 0) continue;
      const stat = welch(controlScores, armScores);
      const deltaStr = Number.isFinite(stat.deltaPct)
        ? `${stat.deltaPct >= 0 ? '+' : ''}${fmt(stat.deltaPct)}%`
        : '—';
      const tStr = Number.isFinite(stat.t) ? fmt(stat.t, 2) : '—';
      lines.push(
        `| ${evalName} | ${fmt(stat.meanControl, 3)} | ${fmt(stat.meanArm, 3)} | ` +
          `${deltaStr} | ${tStr} | ${stat.significant ? '**Yes**' : 'No'} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      task: { type: 'string' },
      control: { type: 'string' },
    },
    allowPositionals: true,
  });

  const runRef = positionals[0];
  if (!runRef) {
    process.stderr.write(
      'Usage: prompt-tax-compare <run-id> [--task <id>] [--control <arm>]\n',
    );
    process.exit(1);
  }

  const taskId = values.task ?? 'portfolio';
  const controlArm = values.control ?? 'control';
  const prefix = `pt-${taskId}-`;
  const controlName = `${prefix}${controlArm}`;

  const evalStore = new EvalStore();
  const dirName = await evalStore.resolveRunDirName(runRef);
  if (!dirName) {
    process.stderr.write(`Error: run "${runRef}" not found.\n`);
    process.exit(1);
  }

  const metadata = await evalStore.loadRunMetadataByDirName(dirName);
  if (!metadata) {
    process.stderr.write(`Error: run metadata not found for "${runRef}".\n`);
    process.exit(1);
  }

  const armNames = metadata.scenarios.filter((n) => n.startsWith(prefix));
  if (!armNames.includes(controlName)) {
    process.stderr.write(
      `Error: control scenario "${controlName}" not found in run. ` +
        `Available prompt-tax scenarios: ${armNames.join(', ') || '(none)'}\n`,
    );
    process.exit(1);
  }

  const control = await loadArmScores(evalStore, dirName, controlName);
  if (!control) {
    process.stderr.write(
      `Error: no completed trial data for control "${controlName}".\n`,
    );
    process.exit(1);
  }

  const treatments: ArmScores[] = [];
  for (const name of armNames) {
    if (name === controlName) continue;
    const arm = await loadArmScores(evalStore, dirName, name);
    if (arm) {
      treatments.push(arm);
    } else {
      process.stderr.write(
        `Warning: no completed trial data for arm "${name}". Skipping.\n`,
      );
    }
  }

  if (treatments.length === 0) {
    process.stderr.write('Error: no treatment arms with trial data to compare.\n');
    process.exit(1);
  }

  process.stdout.write(renderReport(metadata.runId, control, treatments));
  process.stdout.write('\n');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
