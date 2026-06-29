import { createHandoffTool, type HandoffToolConfig } from '@airo/ai-lib';
import type { Tool, ToolExecutionOptions } from 'ai';

import { trackInitialBuildHandoffAsync } from '../services/agent-lifecycle-events/initial-build-funnel.js';

function isSuccessfulHandoffResult(result: unknown): boolean {
  return Boolean(
    result
    && typeof result === 'object'
    && (result as { success?: boolean }).success === true,
  );
}

/**
 * Handoff tool wrapper that emits `build.initial_build_handoff_async` on success.
 */
export function createAgentHandoffTool(config: HandoffToolConfig): Tool {
  const handoff = createHandoffTool(config);
  const originalExecute = handoff.execute;
  if (!originalExecute) {
    return handoff;
  }

  return {
    ...handoff,
    execute: async (input, options: ToolExecutionOptions) => {
      const result = await originalExecute(input, options);
      if (isSuccessfulHandoffResult(result)) {
        const context = options?.experimental_context as { metadata?: { appId?: string } } | undefined;
        const appId = context?.metadata?.appId;
        if (appId) {
          trackInitialBuildHandoffAsync(appId);
        }
      }
      return result;
    },
  };
}
