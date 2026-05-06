import process from 'node:process';
import type { InteractiveUI, MenuOption } from './ui.js';
import type { EvalStore } from '../store/eval-store.js';
import type { BaselineStore } from '../baselines/baseline-store.js';
import type { Scenario } from '../scenarios/types.js';
import { helpText } from './commands/help.js';
import { runEvalCommand } from './commands/eval.js';
import { runScenariosCommand } from './commands/scenarios.js';
import { runConfigCommand } from './commands/config.js';
import { runResultsCommand } from './commands/results.js';
import { runBaselinesCommand } from './commands/baselines.js';

export function buildMainMenu(
  ui: InteractiveUI,
  scenarios: Scenario[],
  evalStore: EvalStore,
  baselineStore: BaselineStore,
): MenuOption[] {
  return [
    {
      key: '1',
      label: 'Run Evals',
      handler: async () => runEvalCommand(ui, scenarios),
    },
    {
      key: '2',
      label: 'List Scenarios',
      handler: async () => runScenariosCommand(ui, scenarios),
    },
    {
      key: '3',
      label: 'Config',
      handler: async () => runConfigCommand(ui),
    },
    {
      key: '4',
      label: 'Results',
      handler: async () => runResultsCommand(ui, evalStore),
    },
    {
      key: '5',
      label: 'Baselines',
      handler: async () =>
        runBaselinesCommand(ui, baselineStore, scenarios),
    },
    {
      key: 'h',
      label: 'Help',
      handler: async () => {
        process.stdout.write(helpText());
        await ui.pressAnyKey();
      },
    },
    {
      key: 'q',
      label: 'Quit',
      handler: async () => {
        process.exit(0);
      },
    },
  ];
}
