import { readFile, readdir, access } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { ScenarioSchema, type Scenario } from './types.js';

// Cache for common instructions keyed by resolved path
const commonInstructionsCache = new Map<string, Record<string, unknown>>();

/**
 * Load common instructions from scenarios/common/instructions.yaml
 */
async function loadCommonInstructions(scenarioDir: string): Promise<Record<string, unknown>> {
  // Try to find common/instructions.yaml relative to scenario
  const possiblePaths = [
    join(dirname(scenarioDir), 'common', 'instructions.yaml'),
    join(scenarioDir, '..', 'common', 'instructions.yaml'),
    join(scenarioDir, '..', '..', 'common', 'instructions.yaml'),
  ];

  for (const path of possiblePaths) {
    // Check cache first
    const cached = commonInstructionsCache.get(path);
    if (cached) return cached;

    try {
      await access(path);
      const content = await readFile(path, 'utf-8');
      const parsed = parseYaml(content) as Record<string, unknown>;
      commonInstructionsCache.set(path, parsed);
      return parsed;
    } catch {
      // Try next path
    }
  }

  // Return empty if not found
  return {};
}

/**
 * Expand ${common.key} references with values from common instructions
 */
function expandCommonRefs(value: string, common: Record<string, unknown>): string {
  return value.replace(/\$\{common\.([^}]+)\}/g, (match, key) => {
    const val = common[key];
    if (typeof val === 'string') {
      return val;
    }
    return match; // Keep original if not found
  });
}

function expandEnvVariables(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    // Skip common.* references (handled separately)
    if (envVar.startsWith('common.')) return `\${${envVar}}`;
    return process.env[envVar] || '';
  });
}

function expandEnvInObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return expandEnvVariables(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvInObject);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvInObject(value);
    }
    return result;
  }
  return obj;
}

function expandCommonInObject(obj: unknown, common: Record<string, unknown>): unknown {
  if (typeof obj === 'string') {
    return expandCommonRefs(obj, common);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => expandCommonInObject(item, common));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandCommonInObject(value, common);
    }
    return result;
  }
  return obj;
}

export async function loadScenario(filePath: string): Promise<Scenario> {
  const content = await readFile(filePath, 'utf-8');
  const ext = extname(filePath).toLowerCase();

  let parsed: unknown;
  if (ext === '.yaml' || ext === '.yml') {
    parsed = parseYaml(content);
  } else if (ext === '.json') {
    parsed = JSON.parse(content);
  } else {
    throw new Error(`Unsupported file format: ${ext}. Use .yaml, .yml, or .json`);
  }

  // Expand env variables first
  const expanded = expandEnvInObject(parsed);

  // Load and expand common references
  const common = await loadCommonInstructions(filePath);
  const withCommon = expandCommonInObject(expanded, common);

  return ScenarioSchema.parse(withCommon);
}

export async function loadAllScenarios(dir: string): Promise<Scenario[]> {
  const files = await readdir(dir);
  const scenarioFiles = files.filter(f =>
    f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
  );

  const scenarios: Scenario[] = [];
  for (const file of scenarioFiles) {
    const scenario = await loadScenario(join(dir, file));
    scenarios.push(scenario);
  }

  return sortByDependencies(scenarios);
}

function sortByDependencies(scenarios: Scenario[]): Scenario[] {
  const scenarioMap = new Map(scenarios.map(s => [s.name, s]));
  const sorted: Scenario[] = [];
  const visited = new Set<string>();

  function visit(scenario: Scenario): void {
    if (visited.has(scenario.name)) return;

    if (scenario.dependsOn) {
      const dependency = scenarioMap.get(scenario.dependsOn);
      if (dependency) {
        visit(dependency);
      }
    }

    visited.add(scenario.name);
    sorted.push(scenario);
  }

  for (const scenario of scenarios) {
    visit(scenario);
  }

  return sorted;
}
