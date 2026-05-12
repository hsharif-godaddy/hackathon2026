import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function setup(): void {
  execFileSync(process.execPath, [resolve(__dirname, 'scripts/generate-cds-deps.js')], {
    stdio: 'inherit',
    cwd: resolve(__dirname),
  });
}
