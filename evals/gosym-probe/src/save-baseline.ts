import process from 'node:process';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config/index.js';
import { GocodeClient } from './clients/gocode-client.js';
import { AABCtrlPlaneClient } from './clients/aab-ctrl-plane-client.js';
import { createAllScenarios } from './scenarios/registry.js';
import { EvalStore } from './store/eval-store.js';
import { BaselineStore } from './baselines/baseline-store.js';
import { createFileStore } from './storage/create-file-store.js';
import {
  buildScenarioIndex,
  findScenariosBySuite,
} from './util/scenario-filters.js';
import { createCliDeps } from './cli/client-factory.js';
import { pickGitFields } from './baselines/types.js';
import { isValidTrialScore } from './baselines/trial-scores.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      suite: { type: 'string' },
      scenario: { type: 'string' },
      s3: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  const runId = positionals[0];
  if (!runId) {
    process.stderr.write(
      'Usage: save-baseline <run-id> [--suite <suite>] [--scenario <name>] [--s3]\n',
    );
    process.exit(1);
  }

  if (values.suite && values.scenario) {
    process.stderr.write(
      'Error: --suite and --scenario are mutually exclusive.\n',
    );
    process.exit(1);
  }

  const config = loadConfig();
  const ctrlPlane = new AABCtrlPlaneClient({
    baseUrl: config.aab.controlPlaneUrl,
  });
  const gocodeClient = new GocodeClient(config.gocode);
  const allScenarios = createAllScenarios(gocodeClient, ctrlPlane, config);
  const evalStore = new EvalStore();
  // --s3 promotes the snapshot to the shared bucket (the manual "only clean,
  // ready baselines go up" step); default writes to the local working tree.
  const useS3: boolean = values.s3 ?? false;
  const baselineStore = new BaselineStore('baselines', createFileStore(config, useS3));

  const metadata = await evalStore.loadRunMetadata(runId);
  if (!metadata) {
    process.stderr.write(
      `Error: run "${runId}" not found in index.\n`,
    );
    process.exit(1);
  }

  const dirName = await evalStore.resolveRunDirName(runId);

  let scenariosToSave = metadata.scenarios;

  if (values.suite) {
    const scenarioIndex = buildScenarioIndex(allScenarios);
    const { scenarios: suiteScenarios, error: suiteError } =
      findScenariosBySuite(scenarioIndex, values.suite);
    if (suiteError) {
      process.stderr.write(`Error: ${suiteError}\n`);
      process.exit(1);
    }
    const suiteNames = new Set(
      suiteScenarios.map((s) => s.name),
    );
    scenariosToSave = metadata.scenarios.filter(
      (name) => suiteNames.has(name),
    );
    if (scenariosToSave.length === 0) {
      process.stderr.write(
        `Error: no scenarios from suite "${values.suite}" ` +
        `found in run "${runId}".\n`,
      );
      process.exit(1);
    }
  } else if (values.scenario) {
    if (!metadata.scenarios.includes(values.scenario)) {
      process.stderr.write(
        `Error: scenario "${values.scenario}" not found in run "${runId}".\n`,
      );
      process.exit(1);
    }
    scenariosToSave = [values.scenario];
  }

  for (const scenarioName of scenariosToSave) {
    const aggregated = await evalStore.loadAggregated(
      runId,
      scenarioName,
    );
    if (!aggregated) {
      process.stderr.write(
        `Warning: aggregated data not found for ` +
        `scenario "${scenarioName}" in run "${runId}". Skipping.\n`,
      );
      continue;
    }

    const trialScoresMap = await buildTrialScoresMap(
      evalStore,
      dirName,
      runId,
      scenarioName,
    );

    const scenario = allScenarios.find((s) => s.name === scenarioName);
    const stabilityLevel = scenario?.stabilityLevel;
    const scoreEvaluatorNames = (scenario?.evaluators ?? [])
      .filter((e) => e.comparisonMode === 'score')
      .map((e) => e.name);

    const writtenPath: string = await baselineStore.saveFromStored(
      runId,
      aggregated,
      stabilityLevel,
      {
        scoreEvaluatorNames,
        defaultThreshold: config.regression.fallbackThresholds.defaultThreshold,
        trialScoresMap,
        ...pickGitFields(metadata),
      },
    );

    // Ask the store for the real destination so the confirmation can't drift
    // from where the object actually landed (prefix join / separator collapse
    // are owned by the store, not re-derived here).
    const location = baselineStore.locationFor(writtenPath);
    process.stdout.write(`Saved baseline (${useS3 ? 's3' : 'local'}): ${location}\n`);
  }
}

async function buildTrialScoresMap(
  evalStore: ReturnType<typeof createCliDeps>['evalStore'],
  dirName: string | null,
  runId: string,
  scenarioName: string,
): Promise<Record<string, number[]>> {
  if (!dirName) return {};

  const trialIndices = await evalStore.listCompletedTrialIndices(
    dirName,
    scenarioName,
  );

  const allResults = await Promise.all(
    trialIndices.map((trialIndex) =>
      evalStore.loadEvalResults(runId, scenarioName, trialIndex),
    ),
  );

  const trialScoresMap: Record<string, number[]> = {};
  for (const evalResults of allResults) {
    if (!evalResults) continue;
    for (const r of evalResults) {
      if (!isValidTrialScore(r)) continue;
      (trialScoresMap[r.evaluator] ??= []).push(r.score);
    }
  }
  return trialScoresMap;
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
