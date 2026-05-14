import process from 'node:process';
import { table } from '../renderer.js';
import type { InteractiveUI, MenuOption } from '../ui.js';
import type { BaselineStore } from '../../baselines/baseline-store.js';
import type { BaselineScores } from '../../baselines/types.js';
import type { Scenario } from '../../scenarios/types.js';
import { spawnAndWait } from '../subprocess.js';
export function formatBaselinesTable(
  entries: Array<{ name: string; baseline: BaselineScores | null }>,
): string {
  if (entries.length === 0) return '  No scenarios found.\n';
  const rows = entries.map(({ name, baseline }) => [
    name,
    baseline ? baseline.runId : '(none)',
    baseline ? baseline.createdAt : '',
  ]);
  return table(['Scenario', 'Baseline Run', 'Created At'], rows);
}

/** Returns the positional args for `pnpm run save-baseline`. */
export function buildSaveBaselineArgs(runId: string): string[] {
  return [runId];
}

export function buildGraduateFlags(scenarioName: string): string[] {
  return ['--graduate', scenarioName];
}

export function buildGraduateSuiteFlags(suiteName: string): string[] {
  return ['--graduate-suite', suiteName];
}

async function viewBaselines(
  ui: InteractiveUI,
  store: BaselineStore,
  scenarios: Scenario[],
): Promise<void> {
  const entries = await Promise.all(
    scenarios.map(async (s) => ({
      name: s.name,
      baseline: (await store.load(s.name))?.scores ?? null,
    })),
  );
  process.stdout.write('\n');
  process.stdout.write(formatBaselinesTable(entries));
  process.stdout.write('\n\n');
  await ui.pressAnyKey();
}

async function saveBaselineFromRun(
  ui: InteractiveUI,
): Promise<void> {
  const runId = await ui.promptInput('Run ID to save as baseline:');
  if (!runId) return;
  await spawnAndWait(
    ui,
    'pnpm',
    ['run', 'save-baseline', ...buildSaveBaselineArgs(runId)],
    'save-baseline exited with errors.',
  );
}

function buildGraduateSuiteOptions(
  ui: InteractiveUI,
  suites: string[],
): MenuOption[] {
  const opts: MenuOption[] = suites.map((suite, i) => ({
    key: String(i + 1),
    label: suite,
    handler: async () => {
      const confirmed = await ui.promptConfirm(
        `Graduate all scenarios in "${suite}"?`,
      );
      if (!confirmed) return;
      await spawnAndWait(
        ui,
        'pnpm',
        ['run', 'eval', ...buildGraduateSuiteFlags(suite)],
        'Eval exited with errors.',
      );
    },
  }));
  opts.push({ key: 'b', label: 'Back', handler: async () => {} });
  return opts;
}

function buildGraduateOptions(
  ui: InteractiveUI,
  scenarios: Scenario[],
): MenuOption[] {
  const opts: MenuOption[] = scenarios.map((s, i) => ({
    key: String(i + 1),
    label: s.name,
    handler: async () => {
      const confirmed = await ui.promptConfirm(
        `Graduate "${s.name}" to regression?`,
      );
      if (!confirmed) return;
      await spawnAndWait(
        ui,
        'pnpm',
        ['run', 'eval', ...buildGraduateFlags(s.name)],
        'Eval exited with errors.',
      );
    },
  }));
  opts.push({ key: 'b', label: 'Back', handler: async () => {} });
  return opts;
}

export async function runBaselinesCommand(
  ui: InteractiveUI,
  store: BaselineStore,
  scenarios: Scenario[],
): Promise<void> {
  const suites = [
    ...new Set(
      scenarios.flatMap((s) => (s.suite ? [s.suite] : [])),
    ),
  ];
  await ui.showMenu('Baselines', [
    {
      key: '1',
      label: 'View current baselines',
      handler: async () => viewBaselines(ui, store, scenarios),
    },
    {
      key: '2',
      label: 'Save baseline from run',
      handler: async () => saveBaselineFromRun(ui),
    },
    {
      key: '3',
      label: 'Graduate scenario',
      handler: async () => {
        await ui.showMenu(
          'Pick scenario to graduate:',
          buildGraduateOptions(ui, scenarios),
        );
      },
    },
    {
      key: '4',
      label: 'Graduate suite',
      handler: async () => {
        if (suites.length === 0) {
          process.stdout.write(
            '\n  No suites configured.\n\n',
          );
          await ui.pressAnyKey();
          return;
        }
        await ui.showMenu(
          'Pick suite to graduate:',
          buildGraduateSuiteOptions(ui, suites),
        );
      },
    },
    { key: 'b', label: 'Back', handler: async () => {} },
  ]);
}
