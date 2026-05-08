import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config/index.js';
import { AABClient } from './clients/aab-client.js';
import { AABCtrlPlaneClient } from './clients/aab-ctrl-plane-client.js';
import { GocodeClient } from './clients/gocode-client.js';
import {
  SetupContextResolver,
  SiteCapture,
} from './clients/dom-capture.js';
import { GocodeSyntheticUser } from './runner/gocode-synthetic-user.js';
import {
  SuiteRunner,
  runCapped,
} from './runner/suite-runner.js';
import { EvalStore } from './store/eval-store.js';
import { BaselineStore } from './baselines/baseline-store.js';
import {
  GraduationRunner,
} from './baselines/graduation-runner.js';
import type { GraduationResult } from './baselines/graduation-runner.js';
import { createAllScenarios } from './scenarios/registry.js';
import {
  validateRunFlags,
  buildScenarioIndex,
  filterScenarios,
  findScenario,
  findScenariosBySuite,
} from './cli/args.js';
import {
  STABILITY_TRIALS,
} from './scenarios/types.js';
import type {
  Scenario,
  StabilityLevel,
} from './scenarios/types.js';

function printGraduationResult(result: GraduationResult): void {
  const {
    scenarioName,
    promoted,
    stabilityLevel,
    stabilityTrials,
    passRates,
    minPassRate,
    passRateThreshold,
  } = result;

  if (promoted) {
    console.log(
      `\n✓ Scenario "${scenarioName}" promoted` +
      ` [${stabilityLevel} / ${stabilityTrials} trials]`,
    );
    console.log('  Baseline saved.');
    const rateStr = Number.isNaN(minPassRate)
      ? 'N/A'
      : `${(minPassRate * 100).toFixed(0)}%`;
    console.log(
      `  Min pass rate: ${rateStr}` +
      ` (threshold: ${(passRateThreshold * 100).toFixed(0)}%)`,
    );
    console.log(
      '\n  To graduate, update the scenario config:',
    );
    console.log(`    category: 'regression'  // was: 'capability'`);
  } else {
    console.error(
      `\n✗ Scenario "${scenarioName}" not promoted` +
      ` [${stabilityLevel} / ${stabilityTrials} trials]`,
    );
    console.error(
      '  Baseline not saved (scenario did not meet pass-rate threshold).',
    );
    console.error(
      `  Per-evaluator pass rates` +
      ` (threshold: ${(passRateThreshold * 100).toFixed(0)}%):`,
    );
    for (const [ev, rate] of Object.entries(passRates)) {
      if (Number.isNaN(rate)) {
        console.error(`    ${ev}: N/A (no valid trials)`);
      } else {
        const flag = rate >= passRateThreshold ? ' ✓' : ' ✗';
        console.error(
          `    ${ev}: ${(rate * 100).toFixed(0)}%${flag}`,
        );
      }
    }
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
      'parallel-suites':  { type: 'boolean' },
      graduate:           { type: 'string' },
      'graduate-suite':   { type: 'string' },
      stability:          { type: 'string' },
    },
  });

  if (values.env) {
    process.env.GD_ENV = values.env;
  }

  const skipBaseline = values['skip-baseline'] ?? false;

  const flagError = validateRunFlags({
    skipBaseline,
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

  const makeAgentClient = async () => {
    const client = new AABClient({ socketUrl: config.aab.socketUrl });
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
  const gocodeClient  = new GocodeClient(config.gocode);
  const syntheticUser = new GocodeSyntheticUser(gocodeClient);

  const ALL_SCENARIOS = createAllScenarios(gocodeClient, ctrlPlane);
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
    const cap =
      concurrencyOverride ?? config.eval.maxConcurrency ?? 1;

    const effectiveLevel = (s: Scenario): StabilityLevel =>
      stabilityOverride ?? s.stabilityLevel ?? 'medium';

    const gradStore = new EvalStore(
      undefined, config.storage?.maxRuns,
    );

    const makeGradRunner = (s: Scenario) =>
      new GraduationRunner({
        scenario: s,
        config,
        makeAgentClient,
        syntheticUser,
        siteCapture,
        baselineStore: new BaselineStore(),
        stabilityLevelOverride: stabilityOverride,
        concurrencyOverride,
        maxTurnsOverride,
        store: gradStore,
      });

    const runScenario = async (
      gradScenario: Scenario,
    ): Promise<GraduationResult> => {
      const level = effectiveLevel(gradScenario);
      const trialCount = STABILITY_TRIALS[level];
      const runId = randomUUID();
      console.log(
        `\nGraduation run: ${gradScenario.name} (${runId})`,
      );
      console.log(`Stability: ${level} (${trialCount} trials)`);
      return makeGradRunner(gradScenario).run(runId);
    };

    const lowScenarios = suiteScenarios.filter(
      (s) => effectiveLevel(s) === 'low',
    );
    const medHighScenarios = suiteScenarios.filter(
      (s) => effectiveLevel(s) !== 'low',
    );

    const lowResults = await runCapped(
      lowScenarios.length,
      cap,
      (i) => runScenario(lowScenarios[i]),
    );

    const medHighResults: GraduationResult[] = [];
    for (const gradScenario of medHighScenarios) {
      medHighResults.push(await runScenario(gradScenario));
    }

    const allResults = [...lowResults, ...medHighResults];
    let allPromoted = true;
    for (const gradResult of allResults) {
      printGraduationResult(gradResult);
      if (!gradResult.promoted) allPromoted = false;
    }

    await gradStore.prune();
    process.exit(allPromoted ? 0 : 1);
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

    const singleGradStore = new EvalStore(
      undefined, config.storage?.maxRuns,
    );
    const gradRunner = new GraduationRunner({
      scenario: gradScenario,
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      baselineStore: new BaselineStore(),
      stabilityLevelOverride: stabilityOverride,
      concurrencyOverride,
      maxTurnsOverride,
      store: singleGradStore,
    });

    const runId = randomUUID();
    const level = stabilityOverride
      ?? gradScenario.stabilityLevel
      ?? 'medium';
    const trialCount = STABILITY_TRIALS[level];
    console.log(
      `\nGraduation run: ${gradScenario.name} (${runId})`,
    );
    console.log(`Stability: ${level} (${trialCount} trials)`);

    const gradResult = await gradRunner.run(runId);

    printGraduationResult(gradResult);
    await singleGradStore.prune();
    process.exit(gradResult.promoted ? 0 : 1);
  }

  const baselineStore = skipBaseline ? undefined : new BaselineStore();

  const parallelSuites = values['parallel-suites'] ?? false;

  const runId = randomUUID();
  console.log(`Starting eval run: ${runId}`);
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

  if (parallelSuites) {
    const cap = config.eval.maxConcurrency ?? 1;
    console.log(
      `Suite mode: parallel` +
      ` (${scenarios.length} scenarios,` +
      ` concurrency: ${cap},` +
      ` 1 trial each)`,
    );
  } else {
    const anyParallelTrials = scenarios.some(
      (s) => s.executionMode === 'parallel',
    );
    for (const s of scenarios) {
      const trialCount = trialsOverride ?? s.trials;
      const mode = s.executionMode ?? 'sequential';
      const modeStr = anyParallelTrials ? ` [${mode}]` : '';
      const capStr = mode === 'parallel'
        ? `, concurrency: ${config.eval.maxConcurrency ?? 1}`
        : '';
      console.log(
        `  ${s.name}: ${trialCount} trial(s)${modeStr}${capStr}`,
      );
    }
  }

  const store = new EvalStore(undefined, config.storage?.maxRuns);
  const dirName = await store.initRun(runId, scenarios, config, {
    trialsOverride,
    concurrencyOverride,
    maxTurnsOverride,
  });

  const pendingWrites: Promise<void>[] = [];
  let writeFailures = 0;

  const runner = new SuiteRunner({
    scenarios,
    config,
    makeAgentClient,
    syntheticUser,
    siteCapture,
    trialsOverride,
    concurrencyOverride,
    maxTurnsOverride,
    baselineStore,
    suiteMode: parallelSuites ? 'parallel' : undefined,
    getTrialOutputDir: (scenarioName, trialIndex) =>
      store.ensureTrialDir(dirName, scenarioName, trialIndex),
    onTrialEvaluated: (scenarioName, trial) => {
      const p = store
        .writeTrial(dirName, scenarioName, trial)
        .catch((err: unknown) => {
          writeFailures++;
          console.warn(
            'Warning: failed to write trial',
            { trialIndex: trial.trialIndex, scenarioName },
            err,
          );
        });
      pendingWrites.push(p);
    },
  });

  const results = await runner.run();

  await Promise.all(pendingWrites);

  if (writeFailures > 0) {
    console.error(
      `Error: ${writeFailures} trial write(s) failed; ` +
      'run output may be incomplete.',
    );
    process.exitCode = 1;
  }
  const runDir = await store.finalizeRun(dirName, runId, results);
  await store.prune();

  console.log('\nResults written to:');
  console.log(`  ${runDir}`);

  if (!skipBaseline) {
    const missingBaselines = results.filter(
      (r) => r.regressionStatus?.gate === 'missing-baseline',
    );
    if (missingBaselines.length > 0) {
      for (const r of missingBaselines) {
        console.error(
          `Error: regression scenario "${r.scenarioName}" has no ` +
          `baseline. Run save-baseline after a stable eval run, or ` +
          `use --graduate ${r.scenarioName} to validate stability.`,
        );
      }
      process.exit(1);
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
      process.exit(1);
    }

    for (const r of results) {
      if (r.regressionStatus?.gate === 'warning') {
        console.warn(
          `⚠ Warning: regression detected in "${r.scenarioName}"` +
          ` (low stability). Consider re-graduating at medium or` +
          ` high stability.`,
        );
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
