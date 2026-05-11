import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DOMSnapshot, Transcript } from '../../../runner/transcript.js';
import type { Scenario } from '../../../scenarios/types.js';
import {
  HeroSectionPresenceEvaluator,
  MandatoryStructureComplianceEvaluator,
  NavigationPresenceEvaluator,
  PrimaryCtaPresenceEvaluator,
} from '../structure-checks.js';

const scenario = {
  name: 's',
  persona: { name: 'p', description: 'd', systemPrompt: 'sp' },
  goals: [],
  evaluators: [],
  trials: 1,
  category: 'capability',
} satisfies Scenario;

function makeTranscript(): Transcript {
  return {
    scenarioName: 's',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
  };
}

async function makeSnapshot(html: string): Promise<DOMSnapshot> {
  const htmlPath = join(
    await mkdtemp(join(tmpdir(), 'gosym-structure-')),
    'snapshot.html',
  );
  await writeFile(htmlPath, html, 'utf-8');

  return {
    url: 'https://example.test',
    htmlPath,
    screenshotPath: join(tmpdir(), 'snapshot.png'),
    timestamp: new Date().toISOString(),
    consoleLogs: [],
  };
}

describe('baseline structure checks', function structureTests() {
  it('detects navigation, hero, and CTA', async function detect() {
    const snap = await makeSnapshot([
      '<html><body>',
      '<nav><a href="#services">Services</a></nav>',
      '<header><h1>Paws & Polish Grooming</h1>',
      '<a href="#book">Book Now</a></header>',
      '</body></html>',
    ].join(''));
    const t = makeTranscript();

    await expect(
      new NavigationPresenceEvaluator().evaluate(t, scenario, snap),
    ).resolves.toMatchObject({ verdict: 'pass' });

    await expect(
      new HeroSectionPresenceEvaluator().evaluate(t, scenario, snap),
    ).resolves.toMatchObject({ verdict: 'pass' });

    await expect(
      new PrimaryCtaPresenceEvaluator().evaluate(t, scenario, snap),
    ).resolves.toMatchObject({ verdict: 'pass' });

    await expect(
      new MandatoryStructureComplianceEvaluator().evaluate(t, scenario, snap),
    ).resolves.toMatchObject({ verdict: 'pass' });
  });

  it('fails when CTA is missing', async function cta() {
    const res = await new PrimaryCtaPresenceEvaluator().evaluate(
      makeTranscript(),
      scenario,
      await makeSnapshot('<html><body><h1>Site</h1></body></html>'),
    );
    expect(res.verdict).toBe('fail');
  });
});
