import { generateTextWithTracking } from '@airo/ai-lib';
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common';
import { buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-grants';
import { z } from 'zod';

import { Logger, log } from '../logging/index.js';
import { getAgentModelWithName } from '../utils/model-selection.js';
import {
  extractSchemaTypesFromHtml,
  parseJsonLdBlocks,
} from './aeo-structure-validator.js';
import type { SeoStrategyContext } from './seo-strategy-context.js';

const logger = Logger.create({ component: 'aeo-schema-recommendations' });

const MAX_TYPES_PER_ROUTE = 3;
const MAX_FIELDS_PER_ROUTE = 3;
const MAX_OUTPUT_TOKENS = 2000;

const SYSTEM_PROMPT = `You are an SEO/AEO expert. For each page route, recommend:
1) 1–3 Schema.org JSON-LD @type values for the page
2) 2–3 schema.org property names to include in JSON-LD for those types (e.g. name, url, headline, author, datePublished, address, mainEntity)

Rules:
- Use standard Schema.org types and property names only.
- Fields must be realistic for the recommended types on that page.
- Return JSON only — no markdown or commentary.

Output shape:
{"routes":[{"path":"/","types":["WebSite","Organization"],"fields":["name","url"]}]}`;

const recommendationResponseSchema = z.object({
  routes: z.array(
    z.object({
      path: z.string(),
      types: z.array(z.string()).min(1).max(MAX_TYPES_PER_ROUTE),
      fields: z.array(z.string()).min(1).max(MAX_FIELDS_PER_ROUTE),
    }),
  ),
});

export type AeoRouteSchemaGuidance = {
  types: string[];
  fields: string[];
};

export type RoutePageSignals = {
  path: string;
  title?: string;
  h1?: string;
  existingTypes?: string[];
};

export type RecommendAeoSchemaTypesParams = {
  routes: RoutePageSignals[];
  strategy?: SeoStrategyContext;
  executionContext?: ExecutionContext;
};

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractRoutePageSignals(html: string, path: string): RoutePageSignals {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch?.[1] ? stripHtmlTags(titleMatch[1]) : undefined;
  const h1 = h1Match?.[1] ? stripHtmlTags(h1Match[1]) : undefined;
  const existingTypes = parseJsonLdBlocks(html).length > 0 ? extractSchemaTypesFromHtml(html) : [];

  return {
    path,
    ...(title && { title }),
    ...(h1 && { h1 }),
    ...(existingTypes.length > 0 && { existingTypes }),
  };
}

function normalizeSchemaType(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeSchemaField(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[A-Za-z@][A-Za-z0-9_@]*$/.test(trimmed)) {
    return null;
  }
  return trimmed.replace(/^@/, '');
}

function buildMetadata(executionContext: ExecutionContext | undefined): LitellmMetadata {
  if (executionContext) {
    const base = buildLitellmMetadataFromContext(executionContext, {
      source: LlmCallSource.ServiceSeoAudit,
      agentId: executionContext.metadata?.agentId,
    });
    if (base) {
      const tags = [...new Set([...(base.tags || []), 'source:tool-llm', 'source:seo-audit-aeo'])];
      return { ...base, tags };
    }
  }

  const existing = llmMetadataContext.getStore();
  const userIdentifier = existing?.user;
  const tags = [...new Set([...(existing?.tags || []), 'source:tool-llm', 'source:seo-audit-aeo'])];
  return {
    ...(userIdentifier && { user: userIdentifier }),
    tags,
  };
}

function buildUserPrompt(routes: RoutePageSignals[], strategy?: SeoStrategyContext): string {
  const businessLines: string[] = [];
  if (strategy?.businessInfo.name) {
    businessLines.push(`Business name: ${strategy.businessInfo.name}`);
  }
  if (strategy?.businessInfo.type) {
    businessLines.push(`Business type: ${strategy.businessInfo.type}`);
  }
  if (strategy?.businessInfo.location) {
    businessLines.push(`Location: ${strategy.businessInfo.location}`);
  }
  if (strategy?.businessInfo.targetAudience) {
    businessLines.push(`Audience: ${strategy.businessInfo.targetAudience}`);
  }

  const routeLines = routes.map(route => {
    const parts = [`path: ${route.path}`];
    if (route.title) parts.push(`title: ${route.title}`);
    if (route.h1) parts.push(`h1: ${route.h1}`);
    if (route.existingTypes?.length) {
      parts.push(`existing @type: ${route.existingTypes.join(', ')}`);
    }
    return `- ${parts.join(' | ')}`;
  });

  return [
    businessLines.length > 0 ? `Business context:\n${businessLines.join('\n')}` : '',
    'Pages:',
    ...routeLines,
    '',
    'Recommend schema @type values and 2–3 JSON-LD property names for every listed path.',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseRecommendations(raw: string, expectedPaths: Set<string>): Record<string, AeoRouteSchemaGuidance> {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  }

  const parsed = recommendationResponseSchema.parse(JSON.parse(cleaned));
  const result: Record<string, AeoRouteSchemaGuidance> = {};

  for (const entry of parsed.routes) {
    if (!expectedPaths.has(entry.path)) {
      continue;
    }
    const types = [...new Set(
      entry.types
        .map(normalizeSchemaType)
        .filter((type): type is string => type !== null),
    )].slice(0, MAX_TYPES_PER_ROUTE);
    const fields = [...new Set(
      entry.fields
        .map(normalizeSchemaField)
        .filter((field): field is string => field !== null),
    )].slice(0, MAX_FIELDS_PER_ROUTE);
    if (types.length > 0 && fields.length > 0) {
      result[entry.path] = { types, fields };
    }
  }

  return result;
}

export async function recommendAeoSchemaTypes(
  params: RecommendAeoSchemaTypesParams,
): Promise<Record<string, AeoRouteSchemaGuidance> | null> {
  const { routes, strategy, executionContext } = params;
  if (routes.length === 0) {
    return {};
  }

  const startedAt = Date.now();
  logger.info('aeo.schema_recommendations.begin', { routeCount: routes.length });

  try {
    const { model, modelName } = await getAgentModelWithName('fast');
    const metadata = buildMetadata(executionContext);
    const userPrompt = buildUserPrompt(routes, strategy);
    const appId = executionContext?.metadata?.appId;
    const sessionId = executionContext?.metadata?.sessionId;

    const generateFn = () =>
      generateTextWithTracking({
        model,
        modelName,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        context: {
          description: 'AEO schema recommendations',
          toolName: 'seoAudit',
          ...(appId && { appId }),
          ...(sessionId && { conversationId: sessionId }),
        },
      });

    const llmResult = await llmMetadataContext.run(metadata, generateFn);
    const expectedPaths = new Set(routes.map(route => route.path));
    const recommendations = parseRecommendations(llmResult.text, expectedPaths);

    logger.info('aeo.schema_recommendations.success', {
      routeCount: routes.length,
      recommendedRouteCount: Object.keys(recommendations).length,
      durationMs: Date.now() - startedAt,
    });

    return recommendations;
  } catch (error) {
    log.error(logger, 'aeo.schema_recommendations.error', error as Error, {
      routeCount: routes.length,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
}
