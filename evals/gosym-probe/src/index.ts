import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config/index.js';
import { AABClient } from './clients/aab-client.js';
import { AABCtrlPlaneClient } from './clients/aab-ctrl-plane-client.js';
import { GocodeClient } from './clients/gocode-client.js';
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
import { resolveResumeState } from './store/resolve-resume-state.js';
import type { ResumeState } from './store/resolve-resume-state.js';
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
import { formatRegressionFailureMessage } from './reporters/regression-message.js';

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
  const gocodeClient          = new PerTrialGocodeClient(config.gocode);
  const narrativeGocodeClient = new GocodeClient(config.gocode);
  const syntheticUser         = new GocodeSyntheticUser(gocodeClient);

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
    // fanOut: SuiteRunner handles trial dispatch via runFanOut; trialConcurrency unused.
    const trialConcurrency: number | undefined = fanOut
      ? undefined
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
    if (values.resume && !fanOut) {
      console.error(
        'Error: graduation resume requires --fan-out. ' +
        'Sequential graduation does not support --resume.',
      );
      process.exit(1);
    }

    const gradResumeState: ResumeState | undefined = values.resume
      ? await (async () => {
          const result = await resolveResumeState({
            store: gradStore,
            runRef: values.resume!,
            scenarios: suiteScenarios,
            getTrialCount: (s) => STABILITY_TRIALS[resolveStabilityLevel(stabilityOverride, s)],
            expectedKind: 'graduation',
          });
          if (typeof result === 'string') {
            console.error(`Error: ${result}`);
            process.exit(1);
          }
          return result;
        })()
      : undefined;

    const gradRunId = gradResumeState?.runId ?? randomUUID();
    const releaseGradLockFn = async (): Promise<void> => {
      await gradResumeState?.releaseLock();
    };

    try {
      const gradCompletedOffset = gradResumeState
        ? Array.from(gradResumeState.existingTrialsByScenario.values()).reduce(
            (sum, trials) => sum + trials.length,
            0,
          )
        : 0;
      const suiteReporter = suiteTotalTrials - gradCompletedOffset > 0
        ? new ProgressReporter({
            total: suiteTotalTrials,
            scenarioTrialCounts: suiteScenarioTrialCounts,
            offset: gradCompletedOffset,
          })
        : null;

      const suiteRunner = new GraduationSuiteRunner({
        scenarios: suiteScenarios,
        config,
        makeAgentClient,
        syntheticUser,
        siteCapture,
        stabilityLevelOverride: stabilityOverride,
        trialConcurrency,
        scenarioConcurrency: fanOut ? clampConcurrency(concurrencyOverride, maxConcurrency) : 1,
        suiteMode: fanOut ? 'parallel' : undefined,
        baselineStoreFactory: () => new BaselineStore(),
        maxTurnsOverride,
        trialLifecycle: gocodeClient,
        onTrialEvaluated: makeProgressCallback(suiteReporter),
        store: gradStore,
        dirName: gradResumeState?.dirName,
        existingTrialsByScenario: gradResumeState?.existingTrialsByScenario,
        trialIndicesByScenario: gradResumeState?.trialIndicesByScenario,
        gocode: narrativeGocodeClient,
      });

      const suiteResult: GraduationSuiteRunResult = await suiteRunner.run(gradRunId).finally(releaseGradLockFn);
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

      const degradedGradScenarios = allResults.filter(
        (r) => r.scenarioResult?.droppedTrials !== undefined && r.scenarioResult.droppedTrials > 0,
      );
      if (degradedGradScenarios.length > 0) {
        for (const r of degradedGradScenarios) {
          console.warn(
            `Warning: ${r.scenarioResult!.droppedTrials} trial(s) dropped for "${r.scenarioName}"` +
            ` due to execution failures.`,
          );
        }
      }

      await gradStore.prune();
      const anyUnsaved = allResults.some((r) => !r.baselineSaved);
      process.exit(anyUnsaved || degradedGradScenarios.length > 0 ? 1 : 0);
    } catch (err) {
      await releaseGradLockFn();
      throw err;
    }
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
      gocode: narrativeGocodeClient,
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

  const evalResumeState: ResumeState | undefined = values.resume
    ? await (async () => {
        const result = await resolveResumeState({
          store,
          runRef: values.resume!,
          scenarios,
          getTrialCount: (s, metaOverride) => trialsOverride ?? metaOverride ?? s.trials,
        });
        if (typeof result === 'string') {
          console.error(`Error: ${result}`);
          process.exit(1);
        }
        return result;
      })()
    : undefined;

  const runId = evalResumeState?.runId ?? randomUUID();
  const dirName = evalResumeState?.dirName ?? await store.initRun(runId, scenarios, config, {
    trialsOverride,
    concurrencyOverride,
    maxTurnsOverride,
  });
  const existingTrialsByScenario = evalResumeState?.existingTrialsByScenario ?? new Map<string, TrialResult[]>();
  const trialIndicesByScenario = evalResumeState?.trialIndicesByScenario ?? new Map<string, number[]>();
  const releaseLock = async (): Promise<void> => {
    await evalResumeState?.releaseLock();
  };

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
    const totalTrials = values.resume
      ? Array.from(trialIndicesByScenario.values()).reduce(
          (sum, indices) => sum + indices.length, 0,
        )
      : scenarios.reduce((sum, s) => sum + (trialsOverride ?? s.trials), 0);
    const actualParallelism = Math.min(cap, totalTrials);
    console.log(
      `Fan-out: ${actualParallelism} workers, round-robin across ${scenarios.length} scenarios`,
    );
  }

  for (const s of scenarios) {
    const trialCount = trialsOverride ?? s.trials;
    console.log(`  ${s.name}: ${trialCount} trial(s)`);
  }

  const evalTrialCounts = new Map(
    scenarios.map((s) => {
      const existing = existingTrialsByScenario.get(s.name);
      const remaining = trialIndicesByScenario.get(s.name);
      const count = (existing && remaining)
        ? existing.length + remaining.length
        : trialsOverride ?? s.trials;
      return [s.name, count];
    }),
  );
  const evalTotal = Array.from(evalTrialCounts.values()).reduce((sum, n) => sum + n, 0);
  const completedOffset = values.resume
    ? Array.from(existingTrialsByScenario.values()).reduce(
        (sum, trials) => sum + trials.length,
        0,
      )
    : 0;
  const evalReporter = evalTotal - completedOffset > 0
    ? new ProgressReporter({
        total: evalTotal,
        scenarioTrialCounts: evalTrialCounts,
        offset: completedOffset,
      })
    : null;

  const pendingWrites: Promise<void>[] = [];
  const writeFailures: { scenarioName: string; trialIndex: number; error: unknown }[] = [];

  // fanOut: --concurrency controls the worker pool size (runFanOut uses scenarioConcurrency)
  const trialConcurrency: number | undefined = fanOut ? undefined : concurrencyOverride;
  const scenarioConcurrency: number | undefined = fanOut ? concurrencyOverride : undefined;

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

    const degradedScenarios = results.filter(
      (r) => r.droppedTrials !== undefined && r.droppedTrials > 0,
    );
    if (degradedScenarios.length > 0) {
      for (const r of degradedScenarios) {
        console.warn(
          `Warning: ${r.droppedTrials} trial(s) dropped for "${r.scenarioName}"` +
          ` due to execution failures.`,
        );
      }
      process.exitCode = 1;
    }

    const runDir = await store.finalizeRun(dirName, runId, results, undefined, {
      wallClockMs,
      skipBaseline,
      tostConfig: { alpha: config.regression.alpha, k: config.regression.k },
    }, narrativeGocodeClient);
    await store.prune();

    console.log('\nResults written to:');
    console.log(`  ${runDir}`);

    if (!skipBaseline) {
      const regressionFailures = results.filter(
        (r) => r.regressionStatus?.gate === 'fail',
      );
      if (regressionFailures.length > 0) {
        for (const r of regressionFailures) {
          const skipped = r.regressionStatus!.evaluators.filter((e) => e.type === 'skipped');
          const hasVersionMismatch = skipped.some(
            (e) => 'skipReason' in e && e.skipReason === 'evaluator-version-mismatch',
          );
          if (hasVersionMismatch) {
            console.error(
              `Regression: evaluator version mismatch in "${r.scenarioName}". ` +
              `Regenerate the baseline:\n` +
              `  pnpm run save-baseline <run-id> --scenario ${r.scenarioName}`,
            );
          } else {
            console.error(
              formatRegressionFailureMessage(r.regressionStatus!) ??
              `Regression: statistical evidence of regression detected in "${r.scenarioName}".`,
            );
          }
        }
        process.exitCode = 1;
        return;
      }

      for (const r of results) {
        if (r.regressionStatus?.gate === 'warning') {
          console.warn(
            `Warning: regression detected in "${r.scenarioName}"` +
            ` (fallback threshold). Re-graduate to enable statistical gating.`,
          );
        }
      }
    }
  } finally {
    await Promise.all(pendingWrites);
    await releaseLock();
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
