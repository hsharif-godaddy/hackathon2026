import type { InteractiveUI, MenuOption } from '../ui.js';
import type { Scenario } from '../../scenarios/types.js';
import { createCompleter } from '../autocomplete.js';
import { spawnAndWait } from '../subprocess.js';

export interface EvalOptions {
  scenario?: string;
  suite?: string;
  trials?: number;
  env?: string;
  skipBaseline?: boolean;
}

export function buildEvalFlags(options: EvalOptions): string[] {
  const flags: string[] = [];
  if (options.scenario) {
    flags.push('--scenario', options.scenario);
  }
  if (options.suite) {
    flags.push('--suite', options.suite);
  }
  if (options.trials !== undefined) {
    flags.push('--trials', String(options.trials));
  }
  if (options.env) {
    flags.push('--env', options.env);
  }
  if (options.skipBaseline) {
    flags.push('--skip-baseline');
  }
  return flags;
}

function buildPickScenarioOptions(
  ui: InteractiveUI,
  scenarios: Scenario[],
): MenuOption[] {
  const opts: MenuOption[] = scenarios.map((s, i) => ({
    key: String(i + 1),
    label: s.name,
    handler: async () => spawnAndWait(
      ui,
      'pnpm',
      ['run', 'eval', ...buildEvalFlags({ scenario: s.name })],
      'Eval exited with errors.',
    ),
  }));
  opts.push({ key: 'b', label: 'Back', handler: async () => {} });
  return opts;
}

function buildPickSuiteOptions(
  ui: InteractiveUI,
  suites: string[],
): MenuOption[] {
  if (suites.length === 0) {
    return [
      {
        key: 'b',
        label: 'Back (no suites configured)',
        handler: async () => {},
      },
    ];
  }
  const opts: MenuOption[] = suites.map((suite, i) => ({
    key: String(i + 1),
    label: suite,
    handler: async () => spawnAndWait(
      ui,
      'pnpm',
      ['run', 'eval', ...buildEvalFlags({ suite })],
      'Eval exited with errors.',
    ),
  }));
  opts.push({ key: 'b', label: 'Back', handler: async () => {} });
  return opts;
}

const ENV_NAMES = ['local.dev', 'local.test', 'local.prod'];

async function runCustomEval(
  ui: InteractiveUI,
  scenarios: Scenario[],
): Promise<void> {
  const scenarioNames = scenarios.map((s) => s.name);
  const scenarioName = await ui.promptInput(
    'Scenario name (blank for all):',
    createCompleter(scenarioNames),
  );
  if (scenarioName === null) return;

  const trialsStr = await ui.promptInput(
    'Trials override (blank for default):',
  );
  if (trialsStr === null) return;

  const envStr = await ui.promptInput(
    'Environment (blank for default):',
    createCompleter(ENV_NAMES),
  );
  if (envStr === null) return;

  const options: EvalOptions = {};
  if (scenarioName) options.scenario = scenarioName;
  if (trialsStr) options.trials = parseInt(trialsStr, 10);
  if (envStr) options.env = envStr;

  await spawnAndWait(
    ui, 'pnpm', ['run', 'eval', ...buildEvalFlags(options)],
    'Eval exited with errors.',
  );
}

export async function runEvalCommand(
  ui: InteractiveUI,
  scenarios: Scenario[],
): Promise<void> {
  const suites = [
    ...new Set(
      scenarios.flatMap((s) => (s.suite ? [s.suite] : [])),
    ),
  ];
  await ui.showMenu('Run Evals', [
    {
      key: '1',
      label: 'Run all scenarios',
      handler: async () => spawnAndWait(
        ui, 'pnpm', ['run', 'eval'],
        'Eval exited with errors.',
      ),
    },
    {
      key: '2',
      label: 'Pick scenario',
      handler: async () => {
        await ui.showMenu(
          'Pick a scenario:',
          buildPickScenarioOptions(ui, scenarios),
        );
      },
    },
    {
      key: '3',
      label: 'Pick suite',
      handler: async () => {
        await ui.showMenu(
          'Pick a suite:',
          buildPickSuiteOptions(ui, suites),
        );
      },
    },
    {
      key: '4',
      label: 'Custom run (trials, env, scenario)',
      handler: async () => runCustomEval(ui, scenarios),
    },
    { key: 'b', label: 'Back', handler: async () => {} },
  ]);
}
