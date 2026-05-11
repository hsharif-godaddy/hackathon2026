import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeCtrlPlaneClient, makeGocodeClient } from '../../__tests__/scenario-test-helpers.js';
import { buildAiroBaselineScenarios } from '../build-scenarios.js';
import {
  loadAiroBaselineScenarioDefinitions,
  loadAiroBaselineSyntheticUsers,
} from '../loader.js';
import { buildAiroBaselineScenarioById } from '../scenario-factory.js';

const originalEnable = process.env.GD_AIRO_BASELINE_ENABLE;
const originalEvaluators = process.env.GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS;
const originalSyntheticUsersPath = process.env.GD_AIRO_BASELINE_SYNTHETIC_USERS_PATH;
const originalScenariosPath = process.env.GD_AIRO_BASELINE_SCENARIOS_PATH;
const temporaryDirectories: string[] = [];

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function writeSyntheticUsers(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'airo-baseline-users-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, 'synthetic-users.json'), content, 'utf8');
  return join(directory, 'synthetic-users.json');
}

async function writeScenarios(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'airo-baseline-scenarios-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, 'scenarios.json'), content, 'utf8');
  return join(directory, 'scenarios.json');
}

async function writeAiroBaselineFiles(
  syntheticUsers: string,
  scenarios: string,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'airo-baseline-set-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, 'synthetic-users.json'), syntheticUsers, 'utf8');
  await writeFile(join(directory, 'scenarios.json'), scenarios, 'utf8');
  process.env.GD_AIRO_BASELINE_SYNTHETIC_USERS_PATH =
    join(directory, 'synthetic-users.json');
  process.env.GD_AIRO_BASELINE_SCENARIOS_PATH =
    join(directory, 'scenarios.json');
}

function validScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'airo-baseline-syn_extra',
    name: 'Extra scenario',
    suite: 'airo-baseline',
    syntheticUserId: 'syn_extra',
    syntheticUserName: 'Extra user',
    agentName: 'airo-builder',
    business: {
      industry: 'Services',
      businessName: 'Extra Business',
      businessDescription: 'A test business',
      targetAudience: 'Local customers',
      brandPersonality: ['clear'],
      colorPreferences: ['blue'],
      stylePreferences: ['simple'],
    },
    goal: {
      name: 'Build a website',
      goals: ['Build a site'],
    },
    customerSummary: 'A test customer',
    testingCapability: 'Test capability',
    complexity: 'easy',
    trials: 1,
    maxTurns: 25,
    executionMode: 'sequential',
    category: 'capability',
    llmConfig: {},
    browserConfig: {},
    evaluators: ['baseline'],
    ...overrides,
  };
}

afterEach(async function restore() {
  restoreEnv('GD_AIRO_BASELINE_ENABLE', originalEnable);
  restoreEnv('GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS', originalEvaluators);
  restoreEnv('GD_AIRO_BASELINE_SYNTHETIC_USERS_PATH', originalSyntheticUsersPath);
  restoreEnv('GD_AIRO_BASELINE_SCENARIOS_PATH', originalScenariosPath);
  await Promise.all(
    temporaryDirectories.splice(0).map(function remove(directory) {
      return rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('airo baseline scenarios', function airoBaselineTests() {
  it('does not load baseline scenarios by default', function disabled() {
    delete process.env.GD_AIRO_BASELINE_ENABLE;

    expect(
      buildAiroBaselineScenarios(makeGocodeClient(), makeCtrlPlaneClient()),
    ).toEqual([]);
  });

  it('builds one scenario for each synthetic user when enabled', function enabled() {
    process.env.GD_AIRO_BASELINE_ENABLE = '1';

    const scenarios = buildAiroBaselineScenarios(
      makeGocodeClient(),
      makeCtrlPlaneClient(),
    );

    expect(scenarios).toHaveLength(loadAiroBaselineSyntheticUsers().length);
    expect(scenarios.map((scenario) => scenario.name)).toContain(
      'airo-baseline-syn_a91f3c7d2e4b8051',
    );
  });

  it('throws when a synthetic user has no matching scenario YAML', async function missingScenario() {
    process.env.GD_AIRO_BASELINE_ENABLE = '1';
    await writeAiroBaselineFiles(
      JSON.stringify({
        user1: {
          syntheticId: 'syn_missing',
          testingCapability: 'Complexity: easy |',
          goal: { goals: ['Build a site'] },
        },
      }),
      JSON.stringify({}),
    );

    expect(function build() {
      buildAiroBaselineScenarios(makeGocodeClient(), makeCtrlPlaneClient());
    }).toThrow('Missing scenario YAML for synthetic users: syn_missing');
  });

  it('throws when a scenario YAML references an unknown synthetic user', async function extraScenario() {
    process.env.GD_AIRO_BASELINE_ENABLE = '1';
    await writeAiroBaselineFiles(
      JSON.stringify({}),
      JSON.stringify({
        scenario1: validScenario(),
      }),
    );

    expect(function build() {
      buildAiroBaselineScenarios(makeGocodeClient(), makeCtrlPlaneClient());
    }).toThrow('Scenario YAML references unknown synthetic users: syn_extra');
  });

  it('rejects incomplete scenario YAML with path context', async function incompleteScenario() {
    const path = await writeScenarios(
      JSON.stringify({
        scenario1: {
          key: 'airo-baseline-syn_missing_fields',
          suite: 'airo-baseline',
          syntheticUserId: 'syn_missing_fields',
        },
      }),
    );

    expect(function load() {
      loadAiroBaselineScenarioDefinitions(path);
    }).toThrow(
      `Invalid Airo baseline scenario definition at ${path}#scenario1: missing required fields: name`,
    );
  });

  it('accepts scenario YAML without optional complexity', async function optionalComplexity() {
    const path = await writeScenarios(
      JSON.stringify({
        scenario1: validScenario({ complexity: undefined }),
      }),
    );

    expect(loadAiroBaselineScenarioDefinitions(path)[0]).toMatchObject({
      key: 'airo-baseline-syn_extra',
      syntheticUserId: 'syn_extra',
    });
  });

  it('loads the persona from the personas module', function persona() {
    const scenario = buildAiroBaselineScenarioById(
      'syn_a91f3c7d2e4b8051',
      makeGocodeClient(),
      makeCtrlPlaneClient(),
    );

    expect(scenario.persona.name).toBe('airo-baseline/syn_a91f3c7d2e4b8051');
    expect(scenario.persona.systemPrompt).toContain('Sweet Porch Bakery');
    expect(scenario.goals[0].description).toContain('friendly first website');
  });

  it('wraps unreadable or invalid synthetic user files with path context', async function invalidJson() {
    const path = await writeSyntheticUsers('{bad json');

    expect(function load() {
      loadAiroBaselineSyntheticUsers(path);
    }).toThrow(`Failed to load Airo baseline synthetic users from ${path}`);
  });

  it('rejects array-shaped synthetic user files', async function arrayShape() {
    const path = await writeSyntheticUsers(
      JSON.stringify([{ syntheticId: 'syn_invalid_array_shape' }]),
    );

    expect(function load() {
      loadAiroBaselineSyntheticUsers(path);
    }).toThrow(
      `Airo baseline synthetic users file must contain a top-level object: ${path}`,
    );
  });

  it('logs and suppresses app deletion failures during teardown', async function teardownFailure() {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function warn() {});
    const scenario = buildAiroBaselineScenarioById(
      'syn_a91f3c7d2e4b8051',
      makeGocodeClient(),
      {
        provisionApp: async () => ({ appId: 'test-app', previewUrl: 'http://test' }),
        deleteApp: async () => {
          throw new Error('delete failed');
        },
      } as never,
    );

    await expect(scenario.teardown?.({ appId: 'test-app' })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: failed to delete airo-baseline app test-app'),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('logs when teardown has no app id', async function missingAppId() {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function warn() {});
    const scenario = buildAiroBaselineScenarioById(
      'syn_a91f3c7d2e4b8051',
      makeGocodeClient(),
      makeCtrlPlaneClient(),
    );

    await scenario.teardown?.({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('setup context did not include appId'),
    );
    warnSpy.mockRestore();
  });
});
