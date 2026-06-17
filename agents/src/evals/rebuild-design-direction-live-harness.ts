import { AgentWrapper, createTool, type AgentConfig } from '@airo/ai-lib';
import { z } from 'zod';

import { createInitialAgent } from '../agents/initial-agent.js';
import { getAgentModelWithName } from '../utils/model-selection.js';

export type RecordedWebsiteRebuildCall = {
  url: string;
  designDirection?: string;
};

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Run one Initial Agent turn with a recording `websiteRebuild` stub (no scrape/handoff).
 */
export async function runInitialAgentRebuildTurn(
  userMessage: string,
): Promise<RecordedWebsiteRebuildCall | undefined> {
  const captures: RecordedWebsiteRebuildCall[] = [];
  const config = await createInitialAgent(undefined, undefined, '3.0');
  const websiteRebuild = createTool(
    'Record website rebuild calls for design-direction eval.',
    z.object({
      url: z.string().url(),
      designDirection: z
        .enum(['keep-similar', 'modernize', 'simplify', 'bold'])
        .optional(),
    }),
    async (input) => {
      captures.push({
        url: input.url,
        ...(input.designDirection ? { designDirection: input.designDirection } : {}),
      });
      return { success: true, message: 'eval stub' };
    },
  );

  const { model, modelName } = await getAgentModelWithName('fast');
  const agent = new AgentWrapper(
    {
      ...config,
      model,
      modelName,
      logger: noopLogger,
      tools: { ...config.tools, websiteRebuild },
    } as AgentConfig,
    undefined,
  );

  const result = await agent.generate(userMessage, {
    executionContext: {
      metadata: { appId: 'eval-rebuild-direction', conversationId: 'eval-rebuild-direction' },
    },
  });

  if (captures.length > 0) return captures[0];

  if (!Array.isArray(result.toolCalls)) return undefined;

  for (const call of result.toolCalls) {
    if (!call || typeof call !== 'object' || (call as { toolName?: string }).toolName !== 'websiteRebuild') {
      continue;
    }
    const raw = (call as { args?: unknown; input?: unknown }).args
      ?? (call as { input?: unknown }).input;
    if (!raw || typeof raw !== 'object') continue;
    const input = raw as { url?: string; designDirection?: string };
    if (typeof input.url !== 'string') continue;
    return {
      url: input.url,
      ...(typeof input.designDirection === 'string' ? { designDirection: input.designDirection } : {}),
    };
  }

  return undefined;
}

export function hasLiveRebuildDesignDirectionCredentials(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}
