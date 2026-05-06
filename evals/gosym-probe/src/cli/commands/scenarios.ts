import process from 'node:process';
import { table } from '../renderer.js';
import type { InteractiveUI } from '../ui.js';
import type { Scenario } from '../../scenarios/types.js';

export function formatScenariosTable(scenarios: Scenario[]): string {
  const headers = [
    'Name', 'Category', 'Trials', 'Mode', 'Evaluators',
  ];
  const rows = scenarios.map((s) => [
    s.name,
    s.category,
    String(s.trials),
    s.executionMode ?? 'sequential',
    String(s.evaluators.length),
  ]);
  return table(headers, rows);
}

export async function runScenariosCommand(
  ui: InteractiveUI,
  scenarios: Scenario[],
): Promise<void> {
  process.stdout.write('\n');
  process.stdout.write(formatScenariosTable(scenarios));
  process.stdout.write('\n\n');
  await ui.pressAnyKey();
}
