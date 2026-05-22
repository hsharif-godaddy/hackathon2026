import process from 'node:process';
import { parseArgs } from 'node:util';
import {
  buildScenarioIndex,
  findScenariosBySuite,
} from './args.js';
import { createCliDeps } from './client-factory.js';
import { pickGitFields } from '../baselines/types.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      suite: { type: 'string' },
    },
    allowPositionals: true,
  });

  const runId = positionals[0];
  if (!runId) {
    process.stderr.write(
      'Usage: save-baseline <run-id> [--suite <suite>]\n',
    );
    process.exit(1);
  }

  const {
    scenarios: allScenarios,
    evalStore,
    baselineStore,
    config,
  } = createCliDeps();

  const metadata = await evalStore.loadRunMetadata(runId);
  if (!metadata) {
    process.stderr.write(
      `Error: run "${runId}" not found in index.\n`,
    );
    process.exit(1);
  }

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

    const scenario = allScenarios.find((s) => s.name === scenarioName);
    const stabilityLevel = scenario?.stabilityLevel;
    const scoreEvaluatorNames = (scenario?.evaluators ?? [])
      .filter((e) => e.regressionMode === 'score')
      .map((e) => e.name);

    await baselineStore.saveFromStored(
      runId,
      aggregated,
      stabilityLevel,
      {
        scoreEvaluatorNames,
        defaultThreshold: config.regression.defaultThreshold,
        ...pickGitFields(metadata),
      },
    );

    process.stdout.write(
      `Saved baseline: baselines/${scenarioName}/` +
      `<timestamp>_${runId}.json\n`,
    );
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
