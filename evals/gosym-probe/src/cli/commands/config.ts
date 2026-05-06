import process from 'node:process';
import path from 'node:path';
import { loadConfig } from '../../../config/index.js';
import type { InteractiveUI, MenuOption } from '../ui.js';
import { table, masked } from '../renderer.js';
import {
  readEnvFile,
  writeEnvFile,
  getEnvEntries,
  setEnvValue,
  SENSITIVE_KEYS,
} from '../env-file.js';

const ENV_FILE = path.resolve(process.cwd(), '.env');
const ENVIRONMENTS = ['local.dev', 'local.test', 'local.prod'];

export function formatEnvTable(
  entries: Record<string, string>,
): string {
  const rows = Object.entries(entries).map(([key, value]) => [
    key,
    SENSITIVE_KEYS.includes(key) ? masked(value) : value,
  ]);
  return table(['Key', 'Value'], rows);
}

function formatResolvedConfig(): string {
  try {
    const config = loadConfig();
    const rows: string[][] = [
      ['env', config.env],
      ['aab.controlPlaneUrl', config.aab.controlPlaneUrl],
      ['gocode.baseUrl', config.gocode.baseUrl],
      ['gocode.model', config.gocode.model],
      ['gocode.apiKey', masked(config.gocode.apiKey)],
      ['eval.defaultTrials', String(config.eval.defaultTrials)],
      [
        'eval.maxConcurrency',
        String(config.eval.maxConcurrency ?? 1),
      ],
    ];
    return table(['Field', 'Value'], rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `  Error loading config: ${msg}`;
  }
}

async function viewEnvValues(ui: InteractiveUI): Promise<void> {
  const lines = await readEnvFile(ENV_FILE);
  const entries = getEnvEntries(lines);
  process.stdout.write('\n');
  process.stdout.write(formatEnvTable(entries));
  process.stdout.write('\n\n');
  await ui.pressAnyKey();
}

function buildEditOptions(
  ui: InteractiveUI,
  keys: string[],
  entries: Record<string, string>,
  lines: Awaited<ReturnType<typeof readEnvFile>>,
): MenuOption[] {
  const opts: MenuOption[] = keys.map((key, i) => ({
    key: String(i + 1),
    label: SENSITIVE_KEYS.includes(key)
      ? `${key}  ${masked(entries[key] ?? '')}`
      : `${key}  ${entries[key] ?? ''}`,
    handler: async () => {
      const newValue = await ui.promptInput(
        `New value for ${key}:`,
      );
      if (newValue === null) return;
      const updated = setEnvValue(lines, key, newValue);
      await writeEnvFile(ENV_FILE, updated);
      process.stdout.write(`  ${key} updated\n`);
    },
  }));
  opts.push({ key: 'b', label: 'Back', handler: async () => {} });
  return opts;
}

async function editValue(ui: InteractiveUI): Promise<void> {
  const lines = await readEnvFile(ENV_FILE);
  const entries = getEnvEntries(lines);
  const keys = Object.keys(entries);
  const opts = buildEditOptions(ui, keys, entries, lines);
  await ui.showMenu('Edit a value:', opts);
}

async function switchEnvironment(
  ui: InteractiveUI,
): Promise<void> {
  const envOptions: MenuOption[] = ENVIRONMENTS.map((env, i) => ({
    key: String(i + 1),
    label: env,
    handler: async () => {
      const lines = await readEnvFile(ENV_FILE);
      const updated = setEnvValue(lines, 'GD_ENV', env);
      await writeEnvFile(ENV_FILE, updated);
      process.stdout.write(`  GD_ENV switched to ${env}\n`);
    },
  }));
  envOptions.push({
    key: 'b',
    label: 'Back',
    handler: async () => {},
  });
  await ui.showMenu('Switch environment:', envOptions);
}

async function viewResolvedConfig(
  ui: InteractiveUI,
): Promise<void> {
  process.stdout.write('\n');
  process.stdout.write(formatResolvedConfig());
  process.stdout.write('\n\n');
  await ui.pressAnyKey();
}

export async function runConfigCommand(
  ui: InteractiveUI,
): Promise<void> {
  await ui.showMenu('Config', [
    {
      key: '1',
      label: 'View .env values',
      handler: async () => viewEnvValues(ui),
    },
    {
      key: '2',
      label: 'Edit a value',
      handler: async () => editValue(ui),
    },
    {
      key: '3',
      label: 'Switch environment',
      handler: async () => switchEnvironment(ui),
    },
    {
      key: '4',
      label: 'View resolved config',
      handler: async () => viewResolvedConfig(ui),
    },
    { key: 'b', label: 'Back', handler: async () => {} },
  ]);
}

