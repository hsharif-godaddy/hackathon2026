import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import { rebuildUserPersona } from '../../personas/rebuild-user.js';
import { RebuildExecutionHealthEvaluator } from '../../evaluators/rebuild-execution-health.js';
import { ToolCallVerificationEvaluator } from '../../evaluators/tool-call-verification.js';
import { ToolFailureRateEvaluator } from '../../evaluators/tool-failure-rate.js';
import type { Scenario } from '../types.js';

const DEFAULT_SOURCE_URL = 'https://example.com';

export function rebuildSourceUrl(): string {
  return process.env.PROBE_REBUILD_SOURCE_URL?.trim() || DEFAULT_SOURCE_URL;
}

export function rebuildFromUrlScenario(
  _gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  const sourceUrl = rebuildSourceUrl();

  return {
    name: 'rebuild-from-url',
    suite: 'rebuild',
    persona: rebuildUserPersona,
    staticFirstMessage:
      `Rebuild my website from ${sourceUrl}. Keep a similar look and layout. ` +
      'My business is Harbor Cafe, a neighborhood coffee shop.',
    goals: [
      {
        description: 'The agent starts a rebuild flow for the provided source URL',
        assertion: 'positive',
      },
      {
        description:
          'The rebuild pipeline runs websiteRebuild without leaving the session in a failed state',
        assertion: 'positive',
      },
    ],
    expectedTools: [
      {
        tool: 'websiteRebuild',
        called: true,
        toolPattern: /websiteRebuild/i,
      },
    ],
    evaluators: [
      new RebuildExecutionHealthEvaluator(),
      new ToolCallVerificationEvaluator(),
      new ToolFailureRateEvaluator(),
    ],
    trials: 1,

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
