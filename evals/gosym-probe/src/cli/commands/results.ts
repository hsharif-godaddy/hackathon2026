import process from 'node:process';
import { table } from '../renderer.js';
import type { InteractiveUI, MenuOption } from '../ui.js';
import type { EvalStore } from '../../store/eval-store.js';
import type {
  RunMetadata,
  StoredAggregated,
} from '../../store/types.js';

export function formatRunList(
  runs: Array<{
    runId: string;
    timestamp: string;
    kind?: 'eval' | 'graduation';
  }>,
): string {
  if (runs.length === 0) return '  No runs found.\n';
  const rows = runs.map((r, i) => {
    const tag = r.kind === 'graduation' ? ' [graduation]' : '';
    return [String(i + 1), `${r.runId}${tag}`, r.timestamp];
  });
  return table(['#', 'Run ID', 'Timestamp'], rows);
}

export function formatRunSummary(metadata: RunMetadata): string {
  const rows: string[][] = [
    ['Run ID', metadata.runId],
    ['Timestamp', metadata.timestamp],
    ['Git SHA', metadata.gitSha ?? '(none)'],
    ['Scenarios', metadata.scenarios.join(', ')],
    ...(metadata.trialsOverride !== undefined
      ? [['Trials Override', String(metadata.trialsOverride)]]
      : []),
    ...(metadata.concurrencyOverride !== undefined
      ? [[
          'Concurrency Override',
          String(metadata.concurrencyOverride),
        ]]
      : []),
  ];
  return table(['Field', 'Value'], rows);
}

export function formatEvaluatorScores(
  agg: StoredAggregated,
): string {
  const rows = Object.entries(agg.evaluators).map(
    ([name, ev]) => [
      name,
      ev.passAtK ? 'PASS' : 'FAIL',
      `${ev.passingTrials}/${ev.totalTrials}`,
      ev.scores.mean.toFixed(2),
    ],
  );
  return table(
    ['Evaluator', 'Pass@K', 'Passing', 'Mean Score'],
    rows,
  );
}

async function showEvaluatorScores(
  ui: InteractiveUI,
  metadata: RunMetadata,
  store: EvalStore,
): Promise<void> {
  if (metadata.scenarios.length === 1) {
    const agg = await store.loadAggregated(
      metadata.runId,
      metadata.scenarios[0]!,
    );
    if (!agg) {
      process.stdout.write('  No aggregated data found.\n');
      return;
    }
    process.stdout.write('\n');
    process.stdout.write(formatEvaluatorScores(agg));
    process.stdout.write('\n\n');
    await ui.pressAnyKey();
    return;
  }

  const opts: MenuOption[] = metadata.scenarios.map(
    (name, i) => ({
      key: String(i + 1),
      label: name,
      handler: async () => {
        const agg = await store.loadAggregated(
          metadata.runId,
          name,
        );
        if (!agg) {
          process.stdout.write(
            '  No aggregated data found.\n',
          );
          return;
        }
        process.stdout.write('\n');
        process.stdout.write(formatEvaluatorScores(agg));
        process.stdout.write('\n\n');
        await ui.pressAnyKey();
      },
    }),
  );
  opts.push({ key: 'b', label: 'Back', handler: async () => {} });
  await ui.showMenu('Pick a scenario:', opts);
}

function buildRunDetailMenu(
  ui: InteractiveUI,
  metadata: RunMetadata,
  store: EvalStore,
): MenuOption[] {
  return [
    {
      key: '1',
      label: 'View summary',
      handler: async () => {
        process.stdout.write('\n');
        process.stdout.write(formatRunSummary(metadata));
        process.stdout.write('\n\n');
        await ui.pressAnyKey();
      },
    },
    {
      key: '2',
      label: 'View evaluator scores',
      handler: async () => {
        await showEvaluatorScores(ui, metadata, store);
      },
    },
    { key: 'b', label: 'Back', handler: async () => {} },
  ];
}

function buildRunListMenu(
  ui: InteractiveUI,
  runs: Array<{ runId: string; timestamp: string }>,
  store: EvalStore,
): MenuOption[] {
  const opts: MenuOption[] = runs.map((run, i) => ({
    key: String(i + 1),
    label: `${run.runId}  ${run.timestamp}`,
    handler: async () => {
      const metadata = await store.loadRunMetadata(run.runId);
      if (!metadata) {
        process.stdout.write('  Run metadata not found.\n');
        return;
      }
      await ui.showMenu(
        `Run ${run.runId}:`,
        buildRunDetailMenu(ui, metadata, store),
      );
    },
  }));
  opts.push({ key: 'b', label: 'Back', handler: async () => {} });
  return opts;
}

export async function runResultsCommand(
  ui: InteractiveUI,
  store: EvalStore,
): Promise<void> {
  const runs = await store.listRuns();
  if (runs.length === 0) {
    process.stdout.write('\n  No eval runs found.\n\n');
    return;
  }
  process.stdout.write('\n');
  process.stdout.write(formatRunList(runs));
  process.stdout.write('\n\n');
  await ui.showMenu(
    'Select a run:',
    buildRunListMenu(ui, runs, store),
  );
}
