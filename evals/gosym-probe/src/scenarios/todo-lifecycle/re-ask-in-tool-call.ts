import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import { standardPersona } from '../../personas/standard.js';
import { TodoLifecycleEvaluator } from '../../evaluators/todo-lifecycle.js';

export function reAskInToolCallScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return {
    name: 're-ask-in-tool-call',
    suite: 'todo-lifecycle',
    persona: standardPersona,
    agentProfile: 'prompt-optimization',
    staticFirstMessage:
      'I want to build a website for my running shoe brand called Kinetic. ' +
      'We sell premium athletic footwear for distance runners. ' +
      'Make a homepage that showcases our shoe models and brand story.',
    goals: [
      {
        description:
          'Agent asks for business name only once during initial Q&A, ' +
          'never re-asks it post-build',
        assertion: 'positive',
      },
      {
        description:
          'After building, agent does not ask "Let\'s find a name" or similar name question',
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
