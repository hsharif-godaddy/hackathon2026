import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

import type { DOMSnapshot, Transcript } from '../../../runner/transcript.js';
import type { Scenario } from '../../../scenarios/types.js';

const createdDirs: string[] = [];

afterAll(async () => {
  await Promise.all(createdDirs.map((d) => rm(d, { recursive: true, force: true })));
});

export const testScenario: Scenario = {
  name: 'test-scenario',
  persona: { name: 'p', description: 'd', systemPrompt: 'sp' },
  goals: [],
  evaluators: [],
  trials: 1,
  category: 'capability',
};

export function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    scenarioName: 'test-scenario',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
    ...overrides,
  };
}

export async function makeSnapshot(html: string): Promise<DOMSnapshot> {
  const dir = await mkdtemp(join(tmpdir(), 'dom-eval-test-'));
  createdDirs.push(dir);
  const htmlPath = join(dir, '0.html');
  await writeFile(htmlPath, html);
  return {
    url: 'https://example.test',
    htmlPath,
    screenshotPath: join(dir, '0.png'),
    timestamp: new Date().toISOString(),
    consoleLogs: [],
  };
}
