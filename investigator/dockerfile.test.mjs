import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Dockerfile copies json-extract for verdict runtime import', async function copy() {
  const dockerfile = await readFile(new URL('./Dockerfile', import.meta.url), 'utf-8');
  const runtimeCopy = dockerfile.match(/COPY handler\.mjs[\s\S]*? \.\/(?=\n)/)?.[0] ?? '';

  assert.match(runtimeCopy, /\bjson-extract\.mjs\b/);
});
