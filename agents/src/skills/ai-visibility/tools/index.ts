import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { generateTextWithTracking, getModel } from '@airo/ai-lib';

import { Logger } from '../../../logging/index.js';
import { getKvMemoryStore } from '../../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../../memory/interfaces/scope.js';
import type { BrandIdentity } from '../../../tools/ai-lib-tools/brand-identity.js';
import { getAgentModelWithName } from '../../../utils/model-selection.js';

const logger = Logger.create({ component: 'ai-visibility-skill' });

const CACHE_TTL_MS = 10 * 60 * 1000;
const HAIKU_TIMEOUT_MS = 10_000;
const PLATFORM_TIMEOUT_MS = 20_000;

async function withLlmTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`LLM call timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface PlatformResult {
  prompt: string;
  platform: string;
  response: string | null;
  error: string | null;
}

interface PromptCacheEntry {
  prompts: string[];
  timestamp: number;
}

interface AiVisibilityResult {
  brandName: string;
  prompts: string[];
  results: PlatformResult[];
}

const promptCache = new Map<string, PromptCacheEntry>();

type Platform = 'chatgpt' | 'claude';

const ALL_PLATFORMS: Platform[] = ['chatgpt', 'claude'];

function resolvePlatforms(input: Platform[] | undefined): Platform[] {
  if (!input || input.length === 0) return ALL_PLATFORMS;
  return input;
}

function promptCacheKey(appId: string, ctx: BrandContext): string {
  return `${appId}:${ctx.brandName}:${ctx.location}:${ctx.vertical}`;
}

function getCachedPrompts(key: string): string[] | null {
  const entry = promptCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    promptCache.delete(key);
    return null;
  }
  return entry.prompts;
}

function setCachedPrompts(key: string, prompts: string[]): void {
  promptCache.set(key, { prompts, timestamp: Date.now() });
}

export function clearAiVisibilityCache(): void {
  promptCache.clear();
}

interface BrandContext {
  brandName: string;
  description: string;
  location: string;
  vertical: string;
}

async function loadBrandContext(appId: string): Promise<BrandContext> {
  const memory = getKvMemoryStore();
  const scope = workspaceScopeFromAppId(appId);

  const [identityResult, summaryResult] = await Promise.all([
    memory.get(scope, 'brand.identity'),
    memory.get(scope, 'brand.summary'),
  ]);

  const identity = identityResult.exists
    ? identityResult.value as BrandIdentity
    : null;

  const brandName: string = identity?.brandName ?? '';
  const location: string = identity?.location ?? '';
  const vertical: string = identity?.vertical ?? '';
  const summaryText: string = summaryResult.exists
    ? (summaryResult.value as { text?: string } | null)?.text ?? ''
    : '';

  const description: string = [
    identity?.personality?.description,
    identity?.audience?.description,
    summaryText,
  ]
    .filter((s): s is string => Boolean(s))
    .join('. ')
    .slice(0, 300);

  return { brandName, location, vertical, description };
}

async function generatePrompts(ctx: BrandContext, appId: string): Promise<string[]> {
  const model = await getModel('haiku');
  const contextParts: string[] = [
    ctx.vertical,
    ctx.description.slice(0, 150),
  ].filter(Boolean);
  const contextClause: string = contextParts.length > 0 ? ` (${contextParts.join(', ')})` : '';
  const locationInstruction: string = ctx.location
    ? `Use the city/region from "${ctx.location}" in location-related queries (not a street address or neighborhood) — e.g. if the location is "123 Main St, Austin TX", use "Austin, TX".`
    : 'Do not infer or include any specific city or location; use "near me" if the business type is location-dependent.';
  const result = await withLlmTimeout(
    (signal: AbortSignal) => generateTextWithTracking({
      model,
      modelName: 'haiku',
      prompt: `Generate 3 to 5 natural search queries that a real person might type into an AI assistant to find or evaluate a business like "${ctx.brandName}"${contextClause}. ${locationInstruction} Return only the queries, one per line, with no numbering, bullets, or extra text.`,
      maxOutputTokens: 200,
      abortSignal: signal,
      context: {
        description: 'AI visibility — generate search queries',
        toolName: 'checkAiVisibility',
        appId,
      },
    }),
    HAIKU_TIMEOUT_MS,
  );

  const prompts: string[] = result.text
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  return prompts;
}

async function queryChatGpt(query: string, appId: string): Promise<PlatformResult> {
  try {
    const model = await getModel('gpt-4o');
    const result = await withLlmTimeout(
      (signal: AbortSignal) => generateTextWithTracking({
        model,
        modelName: 'gpt-4o',
        prompt: query,
        maxOutputTokens: 500,
        abortSignal: signal,
        context: {
          description: 'AI visibility check — ChatGPT',
          toolName: 'checkAiVisibility',
          appId,
        },
      }),
      PLATFORM_TIMEOUT_MS,
    );
    const response: string = result.text.slice(0, 1000);
    return { prompt: query, platform: 'ChatGPT (GPT-4o)', response, error: null };
  } catch (err) {
    const message: string = err instanceof Error ? err.message : String(err);
    logger.warn('aiVisibility.platform.failed', { appId, platform: 'ChatGPT (GPT-4o)', error: message });
    return { prompt: query, platform: 'ChatGPT (GPT-4o)', response: null, error: message };
  }
}

async function queryClaude(query: string, appId: string): Promise<PlatformResult> {
  try {
    const { model, modelName } = await getAgentModelWithName('fast');
    const result = await withLlmTimeout(
      (signal: AbortSignal) => generateTextWithTracking({
        model,
        modelName,
        prompt: query,
        maxOutputTokens: 500,
        abortSignal: signal,
        context: {
          description: 'AI visibility check — Claude',
          toolName: 'checkAiVisibility',
          appId,
        },
      }),
      PLATFORM_TIMEOUT_MS,
    );
    const response: string = result.text.slice(0, 1000);
    return { prompt: query, platform: 'Claude', response, error: null };
  } catch (err) {
    const message: string = err instanceof Error ? err.message : String(err);
    logger.warn('aiVisibility.platform.failed', { appId, platform: 'Claude', error: message });
    return { prompt: query, platform: 'Claude', response: null, error: message };
  }
}

export const checkAiVisibilityTool: SkillToolDefinition = {
  name: 'checkAiVisibility',
  description:
    'Query AI platforms (ChatGPT via GPT-4o, Claude) to check whether the business is mentioned or recommended. ' +
    'Without customPrompts, auto-generates 3–5 search queries tailored to the business (prompts cached for 10 min). ' +
    'With customPrompts, runs the provided queries directly. ' +
    'Use the platforms parameter to restrict to a single provider when the user asks about a specific one (e.g. "ChatGPT only"). ' +
    'Returns { brandName, prompts, results } — prompts is the list of queries that were run.',

  parameters: z.object({
    customPrompts: z.array(z.string().min(1).max(500)).max(5).optional().describe(
      'User-provided queries to run instead of auto-generating them. ' +
      'Use when the user supplies a specific prompt they want to test, e.g. "restaurants in Tempe, AZ". ' +
      'Does not require a brand name.',
    ),
    platforms: z.array(z.enum(['chatgpt', 'claude'])).optional().describe(
      'Restrict which platforms to query. Omit to query both. ' +
      'Use ["chatgpt"] when the user asks only about ChatGPT, ["claude"] when only about Claude.',
    ),
    vertical: z.string().optional().describe('Industry or vertical the business operates in — e.g. "coffee roaster", "law firm", "boutique fashion"'),
    location: z.string().optional().describe('Where the business sells/services customers: a storefront address or a service area — e.g. "123 Main St, Austin TX" or "Serving greater Austin (mobile)"'),
  }),

  async execute(input, context) {
    const appId: string | undefined = context?.metadata?.appId as string | undefined;
    if (!appId) {
      return { error: 'No app context available.' };
    }

    const brandContext: BrandContext = await loadBrandContext(appId);

    if (!brandContext.location && input.location) brandContext.location = input.location;
    if (!brandContext.vertical && input.vertical) brandContext.vertical = input.vertical;

    const isCustom: boolean = (input.customPrompts?.length ?? 0) > 0;
    const platforms: Platform[] = resolvePlatforms(input.platforms as Platform[] | undefined);

    if (!isCustom && !brandContext.brandName) {
      return {
        error: 'No brand name found. Ask the user what their business is called before running the check.',
      };
    }

    let prompts: string[];
    if (isCustom) {
      prompts = input.customPrompts!;
    } else {
      const cacheKey: string = promptCacheKey(appId, brandContext);
      const cached: string[] | null = getCachedPrompts(cacheKey);
      if (cached) {
        logger.info('aiVisibility.prompts.cached', { appId, brandName: brandContext.brandName });
        prompts = cached;
      } else {
        logger.info('aiVisibility.check.start', { appId, brandName: brandContext.brandName, platforms });
        prompts = await generatePrompts(brandContext, appId);
        if (prompts.length === 0) {
          logger.warn('aiVisibility.prompts.empty', { appId, brandName: brandContext.brandName });
          return { error: 'Could not generate search queries for this business. Please try again.' };
        }
        setCachedPrompts(cacheKey, prompts);
      }
    }

    const queryFns: ((prompt: string, appId: string) => Promise<PlatformResult>)[] = [
      ...(platforms.includes('chatgpt') ? [queryChatGpt] : []),
      ...(platforms.includes('claude') ? [queryClaude] : []),
    ];

    const results: PlatformResult[] = await Promise.all(
      prompts.flatMap((prompt: string) => queryFns.map((fn) => fn(prompt, appId))),
    );

    logger.info('aiVisibility.check.complete', {
      appId,
      platforms,
      promptCount: prompts.length,
      results: results.map((r: PlatformResult) => ({ platform: r.platform, succeeded: r.error === null })),
    });

    return {
      brandName: brandContext.brandName,
      prompts,
      results,
    };
  },
};
