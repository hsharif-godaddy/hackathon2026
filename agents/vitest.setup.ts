import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = path.join(tmpdir(), `vitest-agents-${process.pid}`);
mkdirSync(dir, { recursive: true });
process.env.DB_PATH = path.join(dir, 'apps.db');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
