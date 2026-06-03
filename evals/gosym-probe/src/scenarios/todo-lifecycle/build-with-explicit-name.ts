import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import { terseDecisivePersona } from '../../personas/terse-decisive.js';
import { TodoLifecycleEvaluator } from '../../evaluators/todo-lifecycle.js';

export function buildWithExplicitNameScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return {
    name: 'build-with-explicit-name',
    suite: 'todo-lifecycle',
    persona: terseDecisivePersona,
    agentProfile: 'prompt-optimization',
    staticFirstMessage:
      'Build me a homepage for a running shoe brand. Include: ' +
      'a hero section, a product grid, customer testimonials, ' +
      'a rich-text formatting toolbar, a performance stats band, ' +
      'and a footer with newsletter signup.',
    goals: [
      {
        description:
          'After building, the agent does not ask for a business or app name again',
        assertion: 'positive',
      },
      {
        description:
          'Every todoList item the agent worked on is marked complete; ' +
          'deferred pending items are OK on this scoped homepage build',
        assertion: 'positive',
      },
    ],
    evaluators: [new TodoLifecycleEvaluator(gocode)],
    trials: 5,

    setup: async () => {
      const { appId, previewUrl } = await ctrlPlane.provisionApp();
      return { appId, previewUrl };
    },

    teardown: async (ctx) => {
      if (ctx.appId) {
        await ctrlPlane.deleteApp(ctx.appId);
      }
    },
  };
}
