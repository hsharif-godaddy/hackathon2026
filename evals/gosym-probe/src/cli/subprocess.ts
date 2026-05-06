import process from 'node:process';
import type { InteractiveUI } from './ui.js';

export async function spawnAndWait(
  ui: InteractiveUI,
  cmd: string,
  args: string[],
  errorMessage: string,
): Promise<void> {
  const result = await ui.runSubprocess(cmd, args);
  if (result === 'cancelled') return;
  if (result === 'failed') {
    process.stdout.write(`\n  ${errorMessage}\n`);
  }
  await ui.waitForEsc();
}
