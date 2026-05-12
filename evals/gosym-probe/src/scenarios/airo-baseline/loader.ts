import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';
import { z } from 'zod';

import type {
  AiroBaselineBusinessContext,
  AiroBaselineGoal,
  AiroBaselineSyntheticUser,
} from '../../personas/airo-baseline.js';

export interface AiroBaselineScenarioDefinition {
  key: string;
  name: string;
  suite: 'airo-baseline';
  syntheticUserId: string;
  syntheticUserName: string;
  agentName: 'airo-builder';
  business: AiroBaselineBusinessContext;
  goal: AiroBaselineGoal;
  customerSummary: string;
  testingCapability: string;
  trials: number;
  executionMode: 'sequential' | 'parallel';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

interface LoadedObject {
  path: string;
  data: Record<string, unknown>;
}

interface LoadedRecord {
  source: string;
  value: unknown;
}

const nonEmptyString = z.string().min(1);

const requiredScenarioFields = [
  'key',
  'name',
  'suite',
  'syntheticUserId',
  'syntheticUserName',
  'agentName',
  'business',
  'goal',
  'customerSummary',
  'testingCapability',
  'trials',
  'executionMode',
  'llmConfig',
  'browserConfig',
  'evaluators',
];

const scenarioDefinitionSchema = z.object({
  key: nonEmptyString,
  name: nonEmptyString,
  suite: z.literal('airo-baseline'),
  syntheticUserId: nonEmptyString,
  syntheticUserName: nonEmptyString,
  agentName: z.literal('airo-builder'),
  business: z.object({
    industry: nonEmptyString,
    businessName: nonEmptyString,
    businessDescription: nonEmptyString,
    targetAudience: nonEmptyString,
    brandPersonality: z.array(nonEmptyString).min(1),
    colorPreferences: z.array(nonEmptyString).min(1),
    stylePreferences: z.array(nonEmptyString).min(1),
  }),
  goal: z.object({
    name: nonEmptyString,
    goals: z.array(nonEmptyString).min(1),
  }),
  customerSummary: nonEmptyString,
  testingCapability: nonEmptyString,
  trials: z.number().int().positive(),
  executionMode: z.enum(['sequential', 'parallel']),
  llmConfig: z.object({}).passthrough(),
  browserConfig: z.object({}).passthrough(),
  evaluators: z.array(z.unknown()).min(1),
});

function defaultSyntheticUsersPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../airo-baseline-set/synthetic-users',
  );
}

function defaultScenariosPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../airo-baseline-set/scenarios',
  );
}

type Environment = Record<string, string | undefined>;

function environment(): Environment {
  return (
    globalThis as typeof globalThis & {
      process?: { env?: Environment };
    }
  ).process?.env ?? {};
}

export function getAiroBaselineSyntheticUsersPath(): string {
  const env = environment();

  return (
    env.GD_AIRO_BASELINE_SYNTHETIC_USERS_PATH
    ?? env.GD_AAB_REGRESSION_SYNTH_USERS_PATH
    ?? defaultSyntheticUsersPath()
  );
}

export function getAiroBaselineScenariosPath(): string {
  const env = environment();

  return (
    env.GD_AIRO_BASELINE_SCENARIOS_PATH
    ?? env.GD_AAB_REGRESSION_SCENARIOS_PATH
    ?? defaultScenariosPath()
  );
}

export function canLoadAiroBaselineSyntheticUsers(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

export function canLoadAiroBaselineScenarios(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function parseFile(path: string): unknown {
  if (extname(path) === '.json') {
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  return YAML.parse(readFileSync(path, 'utf8'));
}

function loadObject(path: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = parseFile(path);
  } catch (error) {
    throw new Error(`Failed to load ${label} from ${path}`, {
      cause: error,
    });
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`${label} file must contain a top-level object: ${path}`);
  }

  return parsed;
}

function loadObjects(path: string, label: string): LoadedObject[] {
  try {
    if (statSync(path).isDirectory()) {
      return readdirSync(path)
        .filter(function isYaml(file: string) {
          return ['.yaml', '.yml', '.json'].includes(extname(file));
        })
        .sort()
        .map(function load(file: string) {
          return {
            path: join(path, file),
            data: loadObject(join(path, file), label),
          };
        });
    }
  } catch (error) {
    throw new Error(`Failed to load ${label} from ${path}`, {
      cause: error,
    });
  }

  return [{ path, data: loadObject(path, label) }];
}

function expandRecords(
  records: LoadedObject[],
  discriminator: 'syntheticId' | 'key',
): LoadedRecord[] {
  return records.flatMap(function expand(record) {
    if (typeof record.data[discriminator] === 'string') {
      return [{ source: record.path, value: record.data }];
    }

    return Object.entries(record.data).map(function entry([key, value]) {
      return {
        source: `${record.path}#${key}`,
        value,
      };
    });
  });
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map(function format(issue) {
      const path = Array.isArray(issue.path) ? issue.path.join('.') : '<root>';
      const message = typeof issue.message === 'string'
        ? issue.message
        : JSON.stringify(issue);
      return `${path || '<root>'}: ${message}`;
    })
    .join('; ');
}

function missingRequiredFields(value: Record<string, unknown>): string[] {
  return requiredScenarioFields.filter(function missing(field) {
    return !Object.hasOwn(value, field);
  });
}

function parseScenarioDefinition(
  record: LoadedRecord,
): AiroBaselineScenarioDefinition {
  if (!isPlainObject(record.value)) {
    throw new Error(
      `Invalid Airo baseline scenario definition at ${record.source}: expected object`,
    );
  }

  const missingFields = missingRequiredFields(record.value);
  if (missingFields.length > 0) {
    throw new Error(
      `Invalid Airo baseline scenario definition at ${record.source}: missing required fields: ${missingFields.join(', ')}`,
    );
  }

  const result = scenarioDefinitionSchema.safeParse(record.value);

  if (!result.success) {
    throw new Error(
      `Invalid Airo baseline scenario definition at ${record.source}: ${formatIssues(result.error)}`,
    );
  }

  return result.data;
}

export function loadAiroBaselineSyntheticUsers(
  path = getAiroBaselineSyntheticUsersPath(),
): AiroBaselineSyntheticUser[] {
  return expandRecords(
    loadObjects(path, 'Airo baseline synthetic users'),
    'syntheticId',
  )
    .filter(
      function isSyntheticUser(
        value,
      ): value is LoadedRecord & { value: AiroBaselineSyntheticUser } {
        return isPlainObject(value.value) && typeof value.value.syntheticId === 'string';
      },
    )
    .map(function record(value) {
      return value.value;
    });
}

export function loadAiroBaselineScenarioDefinitions(
  path = getAiroBaselineScenariosPath(),
): AiroBaselineScenarioDefinition[] {
  return expandRecords(
    loadObjects(path, 'Airo baseline scenarios'),
    'key',
  )
    .map(parseScenarioDefinition);
}
