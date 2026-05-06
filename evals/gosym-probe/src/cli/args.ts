import type {
  Scenario,
  StabilityLevel,
} from '../scenarios/types.js';

const VALID_STABILITY_LEVELS: readonly string[] = [
  'low',
  'medium',
  'high',
];

export interface ScenarioIndex {
  byName: Map<string, Scenario>;
  bySuite: Map<string, Scenario[]>;
}

/**
 * Builds an O(1)-lookup index from a scenario registry.
 * Scenarios without a `suite` field are excluded from `bySuite`
 * but remain accessible via `byName`.
 */
export function buildScenarioIndex(
  all: Scenario[],
): ScenarioIndex {
  const byName = new Map<string, Scenario>();
  const bySuite = new Map<string, Scenario[]>();

  for (const scenario of all) {
    byName.set(scenario.name, scenario);
    if (scenario.suite) {
      const group = bySuite.get(scenario.suite) ?? [];
      group.push(scenario);
      bySuite.set(scenario.suite, group);
    }
  }

  return { byName, bySuite };
}

export interface RunFlags {
  skipBaseline: boolean;
  graduate: string | undefined;
  graduateSuite: string | undefined;
  stability: string | undefined;
  trials?: string;
  concurrency?: string;
  maxTurns?: string;
}

/**
 * Validates mutually exclusive flag combinations.
 * Returns an error message string, or null if flags are valid.
 */
export function validateRunFlags(flags: RunFlags): string | null {
  if (flags.graduateSuite && flags.graduate) {
    return (
      '--graduate-suite cannot be combined with --graduate.'
    );
  }
  if (flags.stability && !flags.graduate) {
    return '--stability requires --graduate.';
  }
  if (
    flags.stability
    && !VALID_STABILITY_LEVELS.includes(flags.stability)
  ) {
    return (
      '--stability must be one of: low, medium, high.'
    );
  }
  if (flags.trials !== undefined) {
    const n = parseInt(flags.trials, 10);
    if (Number.isNaN(n) || n < 1) {
      return '--trials must be a positive integer.';
    }
  }
  if (flags.concurrency !== undefined) {
    const n = parseInt(flags.concurrency, 10);
    if (Number.isNaN(n) || n < 1) {
      return '--concurrency must be a positive integer.';
    }
  }
  if (flags.maxTurns !== undefined) {
    const n = parseInt(flags.maxTurns, 10);
    if (Number.isNaN(n) || n < 1) {
      return '--max-turns must be a positive integer.';
    }
  }
  return null;
}

/**
 * Returns all scenarios in the given suite.
 * Returns an error string when the suite is not found.
 */
export function findScenariosBySuite(
  index: ScenarioIndex,
  suite: string,
): { scenarios: Scenario[]; error: string | null } {
  const scenarios = index.bySuite.get(suite);
  if (!scenarios) {
    return {
      scenarios: [],
      error: `Unknown suite: "${suite}".`,
    };
  }
  return { scenarios, error: null };
}

/**
 * Filters scenarios by optional name and/or suite.
 * When both are given they compose with AND logic:
 * suite narrows the name-filter result.
 * Returns all scenarios when neither filter is given.
 * Returns an error string when a filter matches nothing.
 */
export function filterScenarios(
  index: ScenarioIndex,
  scenarioFilter: string | undefined,
  suiteFilter: string | undefined,
): { scenarios: Scenario[]; error: string | null } {
  let scenarios = [...index.byName.values()];

  if (scenarioFilter) {
    const match = index.byName.get(scenarioFilter);
    if (!match) {
      const available = [...index.byName.keys()].join(', ');
      return {
        scenarios: [],
        error: `Unknown scenario: "${scenarioFilter}". `
          + `Available: ${available}`,
      };
    }
    scenarios = [match];
  }

  if (suiteFilter) {
    const suiteScenarios = index.bySuite.get(suiteFilter);
    if (!suiteScenarios) {
      return {
        scenarios: [],
        error: `Unknown suite: "${suiteFilter}".`,
      };
    }
    const suiteNames = new Set(
      suiteScenarios.map((s) => s.name),
    );
    scenarios = scenarios.filter((s) => suiteNames.has(s.name));
    if (scenarios.length === 0) {
      return {
        scenarios: [],
        error: `Unknown suite: "${suiteFilter}".`,
      };
    }
  }

  return { scenarios, error: null };
}

/**
 * Finds a single scenario by exact name.
 * Returns an error string when not found.
 */
export function findScenario(
  index: ScenarioIndex,
  name: string,
): { scenario: Scenario | null; error: string | null } {
  const scenario = index.byName.get(name) ?? null;
  if (!scenario) {
    const available = [...index.byName.keys()].join(', ');
    return {
      scenario: null,
      error:
        `Unknown scenario: "${name}". Available: ${available}`,
    };
  }
  return { scenario, error: null };
}
