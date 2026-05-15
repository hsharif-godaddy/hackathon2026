import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import { createBaselineEvaluators } from '../../evaluators/baseline-evaluators/index.js';
import {
  buildAiroBaselinePersona,
  type AiroBaselineSyntheticUser,
} from '../../personas/airo-baseline.js';
import type { Scenario } from '../types.js';
import {
  type AiroBaselineScenarioDefinition,
  loadAiroBaselineScenarioDefinitions,
  loadAiroBaselineSyntheticUsers,
} from './loader.js';

type Environment = Record<string, string | undefined>;

function environment(): Environment {
  return (
    globalThis as typeof globalThis & {
      process?: { env?: Environment };
    }
  ).process?.env ?? {};
}

function shouldUseBaselineEvaluators(): boolean {
  const env = environment();

  return (
    env.GD_AIRO_BASELINE_USE_BASELINE_EVALUATORS === '1'
    || env.GD_AAB_REGRESSION_USE_BASELINE_EVALUATORS === '1'
  );
}

export function buildAiroBaselineScenarioFromSyntheticUser(
  user: AiroBaselineSyntheticUser,
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  scenarioDefinition: AiroBaselineScenarioDefinition,
): Scenario {
  const useBaselineEvaluators = shouldUseBaselineEvaluators();

  return {
    name: scenarioDefinition.key,
    suite: scenarioDefinition.suite,
    persona: buildAiroBaselinePersona(user, {
      business: scenarioDefinition.business,
      customerSummary: scenarioDefinition.customerSummary,
      testingCapability: scenarioDefinition.testingCapability,
    }),
    goals: scenarioDefinition.goal.goals
      .map(function goal(description) {
        return {
          description,
          assertion: 'positive' as const,
        };
      }),
    evaluators: useBaselineEvaluators ? createBaselineEvaluators(gocode) : [],
    trials: scenarioDefinition.trials,

    setup: async () => {
      const { appId, previewUrl } = await ctrlPlane.provisionApp();
      return { appId, previewUrl };
    },

    teardown: async (ctx) => {
      const appId = ctx.appId as string | undefined;
      if (!appId) {
        console.warn(
          `Warning: airo-baseline teardown skipped for ${user.syntheticId};` +
          ` setup context did not include appId.`,
        );
        return;
      }

      try {
        await ctrlPlane.deleteApp(appId);
      } catch (error) {
        console.warn(
          `Warning: failed to delete airo-baseline app ${appId}` +
          ` for ${user.syntheticId}.`,
          error,
        );
      }
    },
  };
}

export function buildAiroBaselineScenarioById(
  syntheticId: string,
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  const user = loadAiroBaselineSyntheticUsers().find(
    (candidate) => candidate.syntheticId === syntheticId,
  );
  if (!user) {
    throw new Error(`Synthetic user not found: ${syntheticId}`);
  }

  const scenarioDefinition = loadAiroBaselineScenarioDefinitions().find(
    (candidate) => candidate.syntheticUserId === syntheticId,
  );
  if (!scenarioDefinition) {
    throw new Error(`Scenario definition not found for synthetic user: ${syntheticId}`);
  }

  return buildAiroBaselineScenarioFromSyntheticUser(
    user,
    gocode,
    ctrlPlane,
    scenarioDefinition,
  );
}
