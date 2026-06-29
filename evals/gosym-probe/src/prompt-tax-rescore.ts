import process from 'node:process';
import { parseArgs } from 'node:util';
import { EvalStore } from './store/eval-store.js';
import { TrialAggregator } from './runner/trial-aggregator.js';
import { RegressionComparator } from './baselines/regression-comparator.js';
import { extractAllTrialScores } from './baselines/trial-scores.js';
import { loadConfig } from '../config/index.js';
import { GocodeClient } from './clients/gocode-client.js';
import { AABCtrlPlaneClient } from './clients/aab-ctrl-plane-client.js';
import { createAllScenarios } from './scenarios/registry.js';
import type { ScenarioResult, TrialResult } from './runner/types.js';
import type { BaselineScores } from './baselines/types.js';
import type { Scenario } from './scenarios/types.js';

/**
 * prompt-tax-rescore — score each prompt-tax treatment arm against the CONTROL
 * arm as a baseline, through the real TOST RegressionComparator (the gating path
 * PR #4583's margin floor lives in, since made relative).
 *
 * This is a DIFFERENT analysis from prompt-tax-compare (a co-run Welch t-test).
 * It exists to exercise #4583: many prompt-tax quality metrics (e.g. bug-hit-rate)
 * are flat 1.00 → zero-variance baselines. Pre-#4583 those false-flagged any
 * deviation via strict uniform-match; with the relative floor they become proper
 * TOST passes that carry a `Pass (margin-floored)` warning. This script
 * reconstructs ScenarioResults from the stored 140-trial run and reports each
 * arm's gate (pass/warning/fail) + which evaluators were margin-floored.
 *
 * Usage:
 *   pnpm run prompt-tax-rescore <run-id> [--task <id>] [--control <arm>]
 */

interface ArmTrials {
  scenarioName: string;
  arm: string;
  scenario: Scenario;
  trials: TrialResult[];
}

async function loadArm(
  evalStore: EvalStore,
  dirName: string,
  scenarioName: string,
  scenario: Scenario,
): Promise<ArmTrials | null> {
  const indices = await evalStore.listCompletedTrialIndices(dirName, scenarioName);
  if (indices.length === 0) return null;
  const trials: TrialResult[] = [];
  for (const idx of indices) {
    const t = await evalStore.loadTrialResultByDirName(dirName, scenarioName, idx);
    if (t) trials.push(t);
  }
  if (trials.length === 0) return null;
  const arm = scenarioName.replace(/^pt-[^-]+-/, '');
  return { scenarioName, arm, scenario, trials };
}

/**
 * Builds a BaselineScores from an aggregated ScenarioResult + its raw per-trial
 * scores — the same shape BaselineStore writes, so RegressionComparator treats
 * the control arm exactly like a saved baseline.
 */
function baselineFromResult(result: ScenarioResult, trials: TrialResult[]): BaselineScores {
  const trialScoresByEvaluator = extractAllTrialScores(trials);
  return {
    scenarioName: result.scenarioName,
    runId: 'control-as-baseline',
    createdAt: '1970-01-01T00:00:00.000Z',
    stabilityLevel: result.stabilityLevel,
    stabilityTrials: trials.length,
    scores: Object.fromEntries(
      Object.entries(result.aggregated).map(([name, agg]) => {
        const trialScores = trialScoresByEvaluator.get(name);
        return [
          name,
          {
            ...(agg.passAt1 !== undefined && { passAt1: agg.passAt1 }),
            ...(agg.passAtK !== undefined && { passAtK: agg.passAtK }),
            ...(agg.passHatK !== undefined && { passHatK: agg.passHatK }),
            passingTrials: agg.passingTrials,
            totalTrials: agg.totalTrials,
            ...(agg.aggregateScore != null && { aggregateScore: agg.aggregateScore }),
            ...(agg.evalVersion !== undefined && { evalVersion: agg.evalVersion }),
            ...(agg.lowerIsBetter !== undefined && { lowerIsBetter: agg.lowerIsBetter }),
            ...(trialScores !== undefined && trialScores.length > 0 && { trialScores }),
          },
        ];
      }),
    ),
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { task: { type: 'string' }, control: { type: 'string' } },
    allowPositionals: true,
  });

  const runRef = positionals[0];
  if (!runRef) {
    process.stderr.write('Usage: prompt-tax-rescore <run-id> [--task <id>] [--control <arm>]\n');
    process.exit(1);
  }
  const taskId = values.task ?? 'portfolio';
  const controlArm = values.control ?? 'control';
  const prefix = `pt-${taskId}-`;
  const controlName = `${prefix}${controlArm}`;

  const config = loadConfig();
  const evalStore = new EvalStore();
  const dirName = await evalStore.resolveRunDirName(runRef);
  if (!dirName) {
    process.stderr.write(`Error: run "${runRef}" not found.\n`);
    process.exit(1);
  }
  const metadata = await evalStore.loadRunMetadataByDirName(dirName);
  if (!metadata) {
    process.stderr.write(`Error: run metadata not found.\n`);
    process.exit(1);
  }

  // Build the scenario registry so each arm aggregates with its real evaluator
  // config (regressionMode, lowerIsBetter). Network clients are constructed but
  // never used — rescore only reads from disk.
  const ctrlPlane = new AABCtrlPlaneClient({ baseUrl: config.aab.controlPlaneUrl });
  const gocode = new GocodeClient(config.gocode);
  const scenarioById = new Map(
    createAllScenarios(gocode, ctrlPlane, config).map((s) => [s.name, s]),
  );

  const armNames = metadata.scenarios.filter((n) => n.startsWith(prefix));
  const controlScenario = scenarioById.get(controlName);
  if (!controlScenario) {
    process.stderr.write(`Error: control scenario "${controlName}" not in registry.\n`);
    process.exit(1);
  }
  const controlArmData = await loadArm(evalStore, dirName, controlName, controlScenario);
  if (!controlArmData) {
    process.stderr.write(`Error: no trial data for control "${controlName}".\n`);
    process.exit(1);
  }

  const aggregator = new TrialAggregator();
  const comparator = new RegressionComparator();

  const controlResult = aggregator.aggregate(controlArmData.scenario, controlArmData.trials);
  const baseline = baselineFromResult(controlResult, controlArmData.trials);

  const lines: string[] = [];
  lines.push(`# prompt-tax rescore (TOST vs control baseline) — \`${metadata.runId}\``);
  lines.push('');
  lines.push(
    `Each arm scored against **${controlName}** as a baseline through the ` +
      `RegressionComparator (TOST), with PR #4583's relative-floor margin ` +
      `(\`max(k·SD, ${config.regression.minMarginFraction}·mean)\`). Gate: pass / warning / fail. ` +
      `\`floored\` = evaluators where the fractional floor exceeded k·SD (low-variance baseline).`,
  );
  lines.push('');
  lines.push('| Arm | Gate | Margin-floored evaluators | Exceeded (regressions) |');
  lines.push('|---|---|---|---|');

  for (const name of armNames) {
    if (name === controlName) continue;
    const scenario = scenarioById.get(name);
    if (!scenario) continue;
    const armData = await loadArm(evalStore, dirName, name, scenario);
    if (!armData) {
      lines.push(`| ${name.replace(prefix, '')} | (no data) | — | — |`);
      continue;
    }
    const result = aggregator.aggregate(armData.scenario, armData.trials);
    const regression = comparator.compare(result, baseline, config.regression);

    const floored = regression.evaluators
      .filter((e) => e.type === 'compared' && e.statistical?.marginFloored === true)
      .map((e) => e.evaluator);
    const exceeded = regression.evaluators
      .filter((e) => e.type === 'compared' && e.exceeded === true)
      .map((e) => e.evaluator);

    lines.push(
      `| ${armData.arm} | ${regression.gate.toUpperCase()} | ` +
        `${floored.length ? floored.join(', ') : '—'} | ` +
        `${exceeded.length ? exceeded.join(', ') : 'none'} |`,
    );
  }

  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
