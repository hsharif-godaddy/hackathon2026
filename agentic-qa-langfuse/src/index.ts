import { parseArgs } from 'node:util';

import { DEFAULT_WORKERS, load } from './config.js';
import { run, runIntent } from './pipeline.js';

// Strip standalone '--' that pnpm injects when forwarding script args
const args = process.argv.slice(2).filter(a => a !== '--');

const { values } = parseArgs({
  args,
  options: {
    session: { type: 'string', multiple: true },
    hours: { type: 'string' },
    workers: { type: 'string' },
    intent: { type: 'boolean', default: false },
  },
  strict: false,
});

const sessions = values.session as string[] | undefined;
const hours = values.hours as string | undefined;

if (!sessions?.length && !hours) {
  console.error('Error: provide at least --session <id> or --hours <N> to scope the run.');
  console.error('  Example: tsx src/index.ts --session abc123');
  console.error('  Example: tsx src/index.ts --hours 24');
  console.error('  Example: tsx src/index.ts --intent --hours 24');
  process.exit(1);
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n !== Math.floor(n)) {
    console.error(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return n;
}

const config = load();
const workers = parsePositiveInt(values.workers as string | undefined, DEFAULT_WORKERS, 'workers');
const parsedHours = hours ? parsePositiveInt(hours, 0, 'hours') : undefined;

if (values.intent) {
  await runIntent(config, { sessions, hours: parsedHours, workers });
} else {
  await run(config, { sessions, hours: parsedHours, workers });
}
