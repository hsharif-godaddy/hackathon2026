import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config/index.js';
import { AABClient } from './clients/aab-client.js';
import { AABCtrlPlaneClient } from './clients/aab-ctrl-plane-client.js';
import { PerTrialGocodeClient } from './clients/per-trial-gocode-client.js';
import {
  SetupContextResolver,
  SiteCapture,
} from './clients/dom-capture.js';
import { GocodeSyntheticUser } from './runner/gocode-synthetic-user.js';
import {
  SuiteRunner,
} from './runner/suite-runner.js';
import {
  clampConcurrency,
  effectiveConcurrency,
} from './util/concurrency.js';
import type { TrialResult } from './runner/types.js';
import { EvalStore } from './store/eval-store.js';
import { BaselineStore } from './baselines/baseline-store.js';
import {
  GraduationRunner,
} from './baselines/graduation-runner.js';
import type { GraduationResult } from './baselines/graduation-runner.js';
import { GraduationSuiteRunner } from './baselines/graduation-suite-runner.js';
import type { GraduationSuiteRunResult } from './baselines/graduation-suite-runner.js';
import { createAllScenarios } from './scenarios/registry.js';
import {
  validateRunFlags,
  validateBaselineRunId,
  buildScenarioIndex,
  filterScenarios,
  findScenario,
  findScenariosBySuite,
} from './cli/args.js';
import {
  resolveStabilityLevel,
  STABILITY_TRIALS,
} from './scenarios/types.js';
import { ProgressReporter } from './util/progress-reporter.js';
import type {
  Scenario,
  StabilityLevel,
} from './scenarios/types.js';

function makeProgressCallback(
  reporter: ProgressReporter | null,
): (scenarioName: string, trial: TrialResult) => void {
  return (scenarioName, trial) =>
    reporter?.trialCompleted(scenarioName, trial.trialIndex);
}

function printGraduationResult(result: GraduationResult): void {
  const { scenarioName, stabilityLevel, stabilityTrials, baselineSaved } = result;
  console.log(
    `\n✓ Scenario "${scenarioName}" graduated` +
    ` [${stabilityLevel} / ${stabilityTrials} trials]`,
  );
  if (baselineSaved) {
    console.log('  Baseline saved.');
  } else {
    console.warn('  Baseline NOT saved (all trials produced unknown verdicts).');
  }
}

function scenarioSetMismatch(
  savedScenarioNames: string[],
  scenarios: Scenario[],
): string | null {
  const currentScenarioNames = scenarios.map((scenario) => scenario.name);
  const saved = new Set(savedScenarioNames);
  const current = new Set(currentScenarioNames);
  const missing = savedScenarioNames.filter((name) => !current.has(name));
  const extra = currentScenarioNames.filter((name) => !saved.has(name));

  if (missing.length === 0 && extra.length === 0) return null;

  return [
    'Current scenario set does not match the resumed run.',
    missing.length > 0
      ? `Missing from current run: ${missing.join(', ')}.`
      : '',
    extra.length > 0
      ? `Extra in current run: ${extra.join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      scenario:           { type: 'string' },
      suite:              { type: 'string' },
      env:                { type: 'string' },
      trials:             { type: 'string' },
      concurrency:        { type: 'string' },
      'max-turns':        { type: 'string' },
      'skip-baseline':    { type: 'boolean' },
      baseline:           { type: 'string' },
      'fan-out':          { type: 'boolean' },
      graduate:           { type: 'string' },
      'graduate-suite':   { type: 'string' },
      resume:             { type: 'string' },
      stability:          { type: 'string' },
    },
  });

  if (values.env) {
    process.env.GD_ENV = values.env;
  }

  const skipBaseline = values['skip-baseline'] ?? false;

  const flagError = validateRunFlags({
    skipBaseline,
    baseline: values.baseline,
    graduate: values.graduate,
    graduateSuite: values['graduate-suite'],
    stability: values.stability,
    concurrency: values.concurrency,
    maxTurns: values['max-turns'],
  });
  if (flagError) {
    console.error(`Error: ${flagError}`);
    process.exit(1);
  }

  const config = loadConfig();

  const trialsOverride = values.trials
    ? parseInt(values.trials, 10)
    : undefined;
  const concurrencyOverride = values.concurrency
    ? parseInt(values.concurrency, 10)
    : undefined;
  const maxTurnsOverride = values['max-turns']
    ? parseInt(values['max-turns'], 10)
    : undefined;

  const makeAgentClient = async (scenario?: Scenario) => {
    const client = new AABClient({
      socketUrl: config.aab.socketUrl,
      ...(scenario?.agentProfile ? {
        auth: {
          agentContext: {
            siteId: 'bypass-site',
            agentProfile: scenario.agentProfile,
            agentProfileSelectorEnabled: true,
          },
        },
      } : {}),
    });
    await client.waitForConnection();
    return client;
  };
  const ctrlPlane     = new AABCtrlPlaneClient({
    baseUrl: config.aab.controlPlaneUrl,
  });
  const siteCapture   = new SiteCapture({
    resolver: new SetupContextResolver(),
    ignoreHttpsErrors: config.playwright.ignoreHttpsErrors,
  });
  const gocodeClient  = new PerTrialGocodeClient(config.gocode);
  const syntheticUser = new GocodeSyntheticUser(gocodeClient);

  const ALL_SCENARIOS = createAllScenarios(gocodeClient, ctrlPlane, config);
  const scenarioIndex = buildScenarioIndex(ALL_SCENARIOS);

  if (values['graduate-suite']) {
    const {
      scenarios: suiteScenarios,
      error: suiteError,
    } = findScenariosBySuite(
      scenarioIndex, values['graduate-suite'],
    );
    if (suiteError) {
      console.error(`Error: ${suiteError}`);
      process.exit(1);
    }

    const stabilityOverride = values.stability as
      StabilityLevel | undefined;
    const maxConcurrency = config.eval.maxConcurrency ?? 1;

    const gradStore = new EvalStore(
      undefined, config.storage?.maxRuns,
    );

    const fanOut = values['fan-out'] ?? false;
    const trialConcurrency: number = fanOut
      ? 1
      : effectiveConcurrency(concurrencyOverride, maxConcurrency);

    const suiteScenarioTrialCounts = new Map(
      suiteScenarios.map((s) => {
        const level = resolveStabilityLevel(stabilityOverride, s);
        return [s.name, STABILITY_TRIALS[level]] as [string, number];
      }),
    );
    const suiteTotalTrials = Array.from(suiteScenarioTrialCounts.values()).reduce(
      (sum, n) => sum + n,
      0,
    );
    const suiteReporter = suiteTotalTrials > 0
      ? new ProgressReporter({
          total: suiteTotalTrials,
          scenarioTrialCounts: suiteScenarioTrialCounts,
        })
      : null;

    const runId = randomUUID();
    const suiteRunner = new GraduationSuiteRunner({
      scenarios: suiteScenarios,
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      stabilityLevelOverride: stabilityOverride,
      trialConcurrency,
      scenarioConcurrency: fanOut ? clampConcurrency(concurrencyOverride, maxConcurrency) : 1,
      baselineStoreFactory: () => new BaselineStore(),
      maxTurnsOverride,
      trialLifecycle: gocodeClient,
      onTrialEvaluated: makeProgressCallback(suiteReporter),
      store: gradStore,
    });

    const suiteResult: GraduationSuiteRunResult = await suiteRunner.run(runId);
    suiteReporter?.finish();

    if (suiteResult.errors.length > 0) {
      const { results: completed, errors } = suiteResult;
      if (completed.length > 0) {
        console.error(
          `\n${errors.length} scenario(s) failed. ` +
          `Printing results for ${completed.length} completed scenario(s):`,
        );
        for (const gradResult of completed) {
          printGraduationResult(gradResult);
        }
      }
      for (const inner of errors) {
        console.error('Scenario error:', inner);
      }
      if (suiteResult.finalizationError) {
        console.error(
          `Run finalization also failed: ${suiteResult.finalizationError.message}`,
        );
      }
      await gradStore.prune();
      process.exit(1);
    }
    if (suiteResult.finalizationError) {
      console.error(
        `\nError: run finalization failed: ${suiteResult.finalizationError.message}`,
      );
      await gradStore.prune();
      process.exit(1);
    }
    const allResults = suiteResult.results;
    for (const gradResult of allResults) {
      printGraduationResult(gradResult);
    }

    await gradStore.prune();
    const anyUnsaved = allResults.some((r) => !r.baselineSaved);
    process.exit(anyUnsaved ? 1 : 0);
  }

  const { scenarios, error: filterError } = filterScenarios(
    scenarioIndex,
    values.scenario,
    values.suite,
  );
  if (filterError) {
    console.error(filterError);
    process.exit(1);
  }

  if (values.graduate) {
    const {
      scenario: gradScenario,
      error: findError,
    } = findScenario(scenarioIndex, values.graduate);
    if (findError || !gradScenario) {
      console.error(
        findError ?? 'Unknown error finding scenario.',
      );
      process.exit(1);
    }

    const stabilityOverride = values.stability as
      StabilityLevel | undefined;
    const maxConcurrency = config.eval.maxConcurrency ?? 1;

    const singleGradStore = new EvalStore(
      undefined, config.storage?.maxRuns,
    );

    const runId = randomUUID();
    const level = resolveStabilityLevel(stabilityOverride, gradScenario);
    const trialCount = STABILITY_TRIALS[level];
    const gradReporter = new ProgressReporter({
      total: trialCount,
      scenarioTrialCounts: new Map([[gradScenario.name, trialCount]]),
    });

    const gradRunner = new GraduationRunner({
      scenario: gradScenario,
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      baselineStore: new BaselineStore(),
      stabilityLevelOverride: stabilityOverride,
      trialConcurrency: concurrencyOverride,
      maxTurnsOverride,
      trialLifecycle: gocodeClient,
      onTrialEvaluated: makeProgressCallback(gradReporter),
      store: singleGradStore,
    });

    console.log(
      `\nGraduation run: ${gradScenario.name} (${runId})`,
    );
    console.log(`Stability: ${level} (${trialCount} trials)`);

    const gradResult = await gradRunner.run(runId);
    gradReporter.finish();

    printGraduationResult(gradResult);
    await singleGradStore.prune();
    process.exit(gradResult.baselineSaved ? 0 : 1);
  }

  const baselineStore = skipBaseline ? undefined : new BaselineStore();

  if (values.baseline) {
    const baselineError = await validateBaselineRunId(
      scenarios,
      baselineStore!,
      values.baseline,
    );
    if (baselineError) {
      console.error(`Error: ${baselineError}`);
      process.exit(1);
    }
  }

  const fanOut = values['fan-out'] ?? false;

  const store = new EvalStore(undefined, config.storage?.maxRuns);
  let runId: string = randomUUID();
  let dirName: string;
  const existingTrialsByScenario = new Map<string, TrialResult[]>();
  const trialIndicesByScenario = new Map<string, number[]>();
  let releaseRunLock: (() => Promise<void>) | undefined;
  const releaseLock = async (): Promise<void> => {
    if (!releaseRunLock) return;
    const release = releaseRunLock;
    releaseRunLock = undefined;
    await release();
  };

  if (values.resume) {
    const resumeDirName = await store.resolveRunDirName(values.resume);
    if (!resumeDirName) {
      console.error(`Error: run not found for --resume "${values.resume}".`);
      process.exit(1);
    }

    dirName = resumeDirName;
    const metadata = await store.loadRunMetadataByDirName(dirName);
    if (!metadata) {
      console.error(
        `Error: run metadata missing for --resume "${values.resume}"` +
        ` in "${dirName}". Cannot resume an incomplete run directory.`,
      );
      process.exit(1);
    }
    runId = metadata.runId;
    const mismatch = scenarioSetMismatch(metadata.scenarios, scenarios);
    if (mismatch) {
      console.error(
        `Error: cannot resume "${values.resume}". ${mismatch}`,
      );
      process.exit(1);
    }
    releaseRunLock = await store.acquireRunLock(dirName);

    try {
      for (const scenario of scenarios) {
        const trialCount =
          trialsOverride
          ?? metadata.trialsOverride
          ?? scenario.trials;
        const completed = await store.listCompletedTrialIndices(
          dirName,
          scenario.name,
        );
        const existing: TrialResult[] = [];
        for (const trialIndex of completed.filter((i) => i < trialCount)) {
          const trial = await store.loadTrialResultByDirName(
            dirName,
            scenario.name,
            trialIndex,
          );
          if (trial) existing.push(trial);
        }

        existingTrialsByScenario.set(scenario.name, existing);
        trialIndicesByScenario.set(
          scenario.name,
          Array.from({ length: trialCount }, function index(_, i) {
            return i;
          }).filter((i) => !completed.includes(i)),
        );
      }
    } catch (error) {
      await releaseLock();
      throw error;
    }
  } else {
    dirName = await store.initRun(runId, scenarios, config, {
      trialsOverride,
      concurrencyOverride,
      maxTurnsOverride,
    });
  }

  console.log(`Starting eval run: ${runId}`);
  if (values.resume) {
    console.log(`Resuming run directory: ${dirName}`);
  }
  console.log(`Scenarios: ${scenarios.map((s) => s.name).join(', ')}`);
  if (trialsOverride !== undefined) {
    console.log(`Trials override: ${trialsOverride}`);
  }
  if (concurrencyOverride !== undefined) {
    console.log(`Concurrency override: ${concurrencyOverride}`);
  }
  if (maxTurnsOverride !== undefined) {
    console.log(`Max turns override: ${maxTurnsOverride}`);
  }

  const maxConcurrency = config.eval.maxConcurrency ?? 1;
  const cap = effectiveConcurrency(concurrencyOverride, maxConcurrency);

  if (fanOut) {
    const actualParallelism = Math.min(cap, scenarios.length);
    console.log(
      `Fan-out: ${actualParallelism} of ${scenarios.length} scenarios concurrently (1 trial at a time per scenario)`,
    );
  }

  for (const s of scenarios) {
    const trialCount = trialsOverride ?? s.trials;
    console.log(`  ${s.name}: ${trialCount} trial(s)`);
  }

  const evalTrialCounts = new Map(
    scenarios.map((s) => [s.name, trialsOverride ?? s.trials]),
  );
  // evalTotal counts remaining trials (progress denominator) while
  // evalTrialCounts stores full per-scenario counts (display "trial n/k").
  const evalTotal = values.resume
    ? Array.from(trialIndicesByScenario.values()).reduce(
        (sum, indices) => sum + indices.length,
        0,
      )
    : scenarios.reduce((sum, s) => sum + (trialsOverride ?? s.trials), 0);
  const evalReporter = evalTotal > 0
    ? new ProgressReporter({ total: evalTotal, scenarioTrialCounts: evalTrialCounts })
    : null;

  const pendingWrites: Promise<void>[] = [];
  const writeFailures: { scenarioName: string; trialIndex: number; error: unknown }[] = [];

  // fanOut: trial-level is always 1; --concurrency controls scenario-level
  const trialConcurrency: number | undefined = fanOut ? 1 : concurrencyOverride;
  const scenarioConcurrency: number | undefined = fanOut
    ? concurrencyOverride
    : undefined;

  const runner = new SuiteRunner({
    scenarios,
    config,
    makeAgentClient,
    syntheticUser,
    siteCapture,
    trialsOverride,
    trialConcurrency,
    scenarioConcurrency,
    maxTurnsOverride,
    baselineStore,
    baselineRunId: values.baseline,
    suiteMode: fanOut ? 'parallel' : undefined,
    existingTrialsByScenario,
    trialIndicesByScenario,
    getTrialOutputDir: (scenarioName, trialIndex) =>
      store.ensureTrialDir(dirName, scenarioName, trialIndex),
    writePartialTrial: (scenarioName, trialIndex, transcript) =>
      store.writePartialTrial(dirName, scenarioName, trialIndex, transcript),
    onPartialWriteFailed: (scenarioName, trialIndex, error) => {
      writeFailures.push({ scenarioName, trialIndex, error });
    },
    trialLifecycle: gocodeClient,
    onTrialEvaluated: (scenarioName, trial) => {
      evalReporter?.trialCompleted(scenarioName, trial.trialIndex);
      const p = store
        .writeTrial(dirName, scenarioName, trial)
        .catch((err: unknown) => {
          writeFailures.push({
            scenarioName,
            trialIndex: trial.trialIndex,
            error: err,
          });
          console.warn(
            'Warning: failed to write trial',
            { trialIndex: trial.trialIndex, scenarioName },
            err,
          );
        });
      pendingWrites.push(p);
    },
  });

  try {
    const runStartMs = Date.now();
    const results = await runner.run();
    evalReporter?.finish();
    const wallClockMs = Date.now() - runStartMs;
    await Promise.all(pendingWrites);
    if (writeFailures.length > 0) {
      console.error(
        `\nError: ${writeFailures.length} trial write(s) failed;` +
        ` skipping finalization for run directory "${dirName}".`,
      );
      for (const { scenarioName, trialIndex, error } of writeFailures) {
        console.error('  - %s trial %d:', scenarioName, trialIndex, error);
      }
      process.exitCode = 1;
      return;
    }

    const runDir = await store.finalizeRun(dirName, runId, results, undefined, { wallClockMs, skipBaseline });
    await store.prune();

    console.log('\nResults written to:');
    console.log(`  ${runDir}`);

    if (!skipBaseline) {
      const versionSkipped = results.filter(
        (r) => r.regressionStatus?.gate === 'version-skipped',
      );
      if (versionSkipped.length > 0) {
        for (const r of versionSkipped) {
          const skipped = r.regressionStatus!.evaluators.filter(
            (e) => e.type === 'skipped',
          );
          const hasVersionMismatch = skipped.some(
            (e) => 'skipReason' in e && e.skipReason === 'evaluator-version-mismatch',
          );
          const hasDataGap = skipped.some(
            (e) =>
              'skipReason' in e &&
              (e.skipReason === 'no-score-data' || e.skipReason === 'no-trial-data'),
          );
          if (hasVersionMismatch) {
            console.error(
              `Error: evaluator comparisons skipped for "${r.scenarioName}" ` +
              `due to version mismatch. Regenerate the baseline:\n` +
              `  pnpm run save-baseline <run-id> --scenario ${r.scenarioName}`,
            );
          }
          if (hasDataGap) {
            console.error(
              `Error: evaluator comparisons skipped for "${r.scenarioName}" ` +
              `— no score/trial data available. Check probe health or run more trials.`,
            );
          }
        }
        process.exitCode = 1;
        return;
      }

      const regressionFailures = results.filter(
        (r) =>
          r.regressionStatus?.gate === 'error' ||
          r.regressionStatus?.gate === 'critical',
      );
      if (regressionFailures.length > 0) {
        for (const r of regressionFailures) {
          const gate = r.regressionStatus!.gate as 'error' | 'critical';
          const level = r.regressionStatus!.stabilityLevel;
          const label = gate === 'critical' ? 'Critical' : 'Error';
          console.error(
            `${label}: regression detected in "${r.scenarioName}"` +
            ` (${level} stability).`,
          );
        }
        process.exitCode = 1;
        return;
      }

      for (const r of results) {
        if (r.regressionStatus?.gate === 'warning') {
          console.warn(
            `Warning: regression detected in "${r.scenarioName}"` +
            ` (low stability). Consider re-graduating at medium or` +
            ` high stability.`,
          );
        }
      }
    }
  } finally {
    await releaseLock();
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
