import { beginnerPersona } from '../../personas/beginner.js';
import { BugHitRateEvaluator }
  from '../../evaluators/bug-hit-rate.js';
import { PromptEfficiencyEvaluator }
  from '../../evaluators/prompt-efficiency.js';
import { ToolCallVerificationEvaluator }
  from '../../evaluators/tool-call-verification.js';
import { JTBDCompletionEvaluator }
  from '../../evaluators/jtbd-completion.js';
import { createTokenEvaluators }
  from '../../evaluators/create-token-evaluators.js';
import type { GocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

export function multiTurnPublishFlowScenario(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  const tokenEvaluators = createTokenEvaluators(gocode);
  return {
    name: 'pvs-multi-turn-publish-flow',
    suite: 'prompt-vs-skill',
    persona: beginnerPersona,
    goals: [
      {
        description: 'Build a simple hello world site',
        assertion: 'positive',
      },
      {
        description: 'Publish the site to production',
        assertion: 'positive',
      },
      {
        description: 'Is it healthy?',
        assertion: 'positive',
      },
      {
        description: 'Publish the site to production again',
        assertion: 'positive',
      },
    ],
    evaluators: [
      new BugHitRateEvaluator(),
      new PromptEfficiencyEvaluator(),
      new ToolCallVerificationEvaluator(),
      new JTBDCompletionEvaluator(gocode),
      ...tokenEvaluators,
    ],
    trials: 1,
    executionMode: 'sequential',
    category: 'capability',

    setup: async () => {
      const { appId, previewUrl } = await ctrlPlane.provisionApp();
      return { appId, previewUrl };
    },

    teardown: async (ctx) => {
      const appId = ctx.appId;
      if (appId) {
        await ctrlPlane.deleteApp(appId);
      }
    },
  };
}
