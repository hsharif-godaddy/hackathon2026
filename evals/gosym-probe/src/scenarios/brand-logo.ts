import { brandLogoYogaStudioPersona } from '../personas/brand-logo-yoga-studio.js';
import { JTBDCompletionEvaluator } from '../evaluators/jtbd-completion.js';
import { BugHitRateEvaluator } from '../evaluators/bug-hit-rate.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type {
  AABCtrlPlaneClient,
} from '../clients/aab-ctrl-plane-client.js';
import type { Scenario } from './types.js';

export function brandLogoScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return {
    name: 'brand-logo',
    suite: 'brand-logo',
    persona: brandLogoYogaStudioPersona,
    goals: [
      {
        description:
          'Agent discovers brand identity through conversation before generating',
        assertion: 'positive',
      },
      {
        description:
          'Agent generates a complete brand including logo, colors, and typography',
        assertion: 'positive',
      },
      {
        description:
          'The brand output reflects the calming, minimal, natural direction the user requested',
        assertion: 'positive',
      },
    ],
    evaluators: [
      new JTBDCompletionEvaluator(gocode),
      new BugHitRateEvaluator(),
    ],
    trials: 1,

    setup: async () => {
      const { appId, previewUrl } =
        await ctrlPlane.provisionApp();
      return { appId, previewUrl, templateId: 'logo-designer' };
    },

    teardown: async (ctx) => {
      const appId = ctx.appId;
      if (appId) await ctrlPlane.deleteApp(appId);
    },
  };
}
