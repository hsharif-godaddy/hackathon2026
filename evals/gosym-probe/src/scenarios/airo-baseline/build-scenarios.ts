import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { Scenario } from '../types.js';
import {
  canLoadAiroBaselineScenarios,
  canLoadAiroBaselineSyntheticUsers,
  type AiroBaselineScenarioDefinition,
  getAiroBaselineScenariosPath,
  getAiroBaselineSyntheticUsersPath,
  loadAiroBaselineScenarioDefinitions,
  loadAiroBaselineSyntheticUsers,
} from './loader.js';
import { buildAiroBaselineScenarioFromSyntheticUser } from './scenario-factory.js';

type Environment = Record<string, string | undefined>;

function environment(): Environment {
  return (
    globalThis as typeof globalThis & {
      process?: { env?: Environment };
    }
  ).process?.env ?? {};
}

function shouldEnableAiroBaseline(): boolean {
  const env = environment();

  return (
    env.GD_AIRO_BASELINE_ENABLE === '1'
    || env.GD_AAB_REGRESSION_ENABLE === '1'
  );
}

function validatePairing(
  syntheticUserIds: string[],
  scenarioDefinitions: AiroBaselineScenarioDefinition[],
): void {
  const syntheticUserIdSet = new Set(syntheticUserIds);
  const scenarioIds = scenarioDefinitions.map(
    function id(definition) {
      return definition.syntheticUserId;
    },
  );
  const duplicateScenarioIds = scenarioIds.filter(
    function duplicate(id, index) {
      return scenarioIds.indexOf(id) !== index;
    },
  );
  const missingScenarioIds = syntheticUserIds.filter(
    function missing(id) {
      return !scenarioIds.includes(id);
    },
  );
  const extraScenarioIds = scenarioIds.filter(
    function extra(id) {
      return !syntheticUserIdSet.has(id);
    },
  );

  if (
    duplicateScenarioIds.length === 0
    && missingScenarioIds.length === 0
    && extraScenarioIds.length === 0
  ) {
    return;
  }

  throw new Error([
    'Invalid airo-baseline scenario/persona pairing.',
    duplicateScenarioIds.length > 0
      ? `Duplicate scenario syntheticUserId values: ${[...new Set(duplicateScenarioIds)].join(', ')}`
      : '',
    missingScenarioIds.length > 0
      ? `Missing scenario YAML for synthetic users: ${missingScenarioIds.join(', ')}`
      : '',
    extraScenarioIds.length > 0
      ? `Scenario YAML references unknown synthetic users: ${extraScenarioIds.join(', ')}`
      : '',
  ].filter(Boolean).join(' '));
}

export function buildAiroBaselineScenarios(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario[] {
  if (!shouldEnableAiroBaseline()) return [];

  const path = getAiroBaselineSyntheticUsersPath();
  if (!canLoadAiroBaselineSyntheticUsers(path)) return [];

  const scenariosPath = getAiroBaselineScenariosPath();
  if (!canLoadAiroBaselineScenarios(scenariosPath)) return [];

  const syntheticUsers = loadAiroBaselineSyntheticUsers(path)
    .sort((a, b) => a.syntheticId.localeCompare(b.syntheticId));
  const scenarioDefinitionList = loadAiroBaselineScenarioDefinitions(scenariosPath);
  validatePairing(
    syntheticUsers.map(function id(user) {
      return user.syntheticId;
    }),
    scenarioDefinitionList,
  );

  const scenarioDefinitions = new Map(
    scenarioDefinitionList.map(
      function map(definition) {
        return [definition.syntheticUserId, definition];
      },
    ),
  );

  return syntheticUsers
    .map(function build(user) {
      const scenarioDefinition = scenarioDefinitions.get(user.syntheticId);
      if (!scenarioDefinition) {
        throw new Error(`Scenario definition not found for synthetic user: ${user.syntheticId}`);
      }

      return buildAiroBaselineScenarioFromSyntheticUser(
        user,
        gocode,
        ctrlPlane,
        scenarioDefinition,
      );
    });
}
