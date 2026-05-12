import { standardPersona } from '../personas/standard.js';
import { LatencyEvaluator } from '../evaluators/latency-evaluator.js';
import { createTokenEvaluators } from '../evaluators/create-token-evaluators.js';
import type { GocodeClient } from '../clients/gocode-client.js';
import type {
  AABCtrlPlaneClient,
} from '../clients/aab-ctrl-plane-client.js';
import type { Scenario } from './types.js';

const COMPLEX_PROMPT = [
  'Build a complete multi-page website with:',
  '- Homepage with hero, features section, testimonials,',
  '  and CTA',
  '- Product listing page with category filters and search',
  '- Product detail page with image gallery and',
  '  add-to-cart',
  '- Shopping cart with quantity controls and persistent',
  '  state',
  '- Checkout flow with form validation and Stripe',
  '  integration',
  '- User account pages (login, register, order history)',
  '- Admin dashboard with inventory management',
  'Use modern React, TypeScript, and Tailwind CSS.',
].join('\n');

export function complexPromptLatencyScenario(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  const tokenEvaluators = createTokenEvaluators(gocode);
  return {
    name: 'complex-prompt-latency',
    persona: standardPersona,
    goals: [
      {
        description:
          'Agent responds to the build prompt',
        assertion: 'positive',
      },
    ],
    staticFirstMessage: COMPLEX_PROMPT,
    evaluators: [
      new LatencyEvaluator(),
      ...tokenEvaluators,
    ],
    trials: 5,
    executionMode: 'parallel',

    setup: async () => {
      const { appId, previewUrl } =
        await ctrlPlane.provisionApp();
      return { appId, previewUrl };
    },

    teardown: async (ctx) => {
      const appId = ctx.appId;
      if (appId) await ctrlPlane.deleteApp(appId);
    },
  };
}
