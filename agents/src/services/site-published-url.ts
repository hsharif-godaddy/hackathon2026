import type { IClientActionService } from './ClientActionService.js';
import { getActionService } from '../server/agent-runtime.js';
import { Logger } from '../logging/index.js';
import { hasBeenPublished } from '@airo/shared';

const logger = Logger.create({ component: 'site-published-url' });

const GET_SITE_DATA_TIMEOUT_MS = 10_000;

export type GetSiteDataResult = {
  publishedUrl?: string;
  previewUrl?: string;
  variants?: string[];
  variantsWithLifecycle?: Array<{ variant: string; status: string }>;
};

export type SiteSeoContext = {
  publishedUrl: string | null;
  previewUrl: string | null;
  isPublished: boolean;
};

const EMPTY_SITE_SEO_CONTEXT: SiteSeoContext = {
  publishedUrl: null,
  previewUrl: null,
  isPublished: false,
};

function parseGetSiteDataResult(result: unknown): GetSiteDataResult | null {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return result as GetSiteDataResult;
}

export function siteSeoContextFromGetSiteData(result: GetSiteDataResult | null): SiteSeoContext {
  if (!result) {
    return EMPTY_SITE_SEO_CONTEXT;
  }

  const publishedUrl = result.publishedUrl?.trim() || null;
  const previewUrl = result.previewUrl?.trim() || null;
  const isPublished = hasBeenPublished({
    variants: result.variants,
    variantsWithLifecycle: result.variantsWithLifecycle,
  });

  return { publishedUrl, previewUrl, isPublished };
}

/**
 * Site URLs + publish variant state from the app UI site store (same as QR / publish gating).
 */
export async function fetchSiteSeoContextViaGetSiteData(
  appId: string,
  clientActionService: IClientActionService,
): Promise<SiteSeoContext> {
  try {
    const siteDataResult = await clientActionService.executeAction({
      action: 'getSiteData',
      params: { appId },
      timeoutMs: GET_SITE_DATA_TIMEOUT_MS,
    });

    if (!siteDataResult.success || !siteDataResult.result) {
      logger.warn('site.seo_context.get_site_data_failed', {
        appId,
        success: siteDataResult.success,
        error: siteDataResult.error,
        hasResult: Boolean(siteDataResult.result),
      });
      return EMPTY_SITE_SEO_CONTEXT;
    }

    return siteSeoContextFromGetSiteData(parseGetSiteDataResult(siteDataResult.result));
  } catch (error) {
    logger.warn('site.seo_context.get_site_data_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_SITE_SEO_CONTEXT;
  }
}

/**
 * Published URL from the app UI site store (same as QR code / publishing skill).
 */
export async function fetchPublishedUrlViaGetSiteData(
  appId: string,
  clientActionService: IClientActionService,
): Promise<string | null> {
  const context = await fetchSiteSeoContextViaGetSiteData(appId, clientActionService);
  return context.publishedUrl;
}

type ToolContextWithSocket = {
  socketId?: string;
  metadata?: { appId?: string };
};

/**
 * Resolve published URL when a tool runs in an active chat session (WebSocket/SSE).
 */
export async function resolvePublishedUrlFromToolContext(
  appId: string,
  context: ToolContextWithSocket | undefined,
): Promise<string | null> {
  const seoContext = await resolveSiteSeoContextFromToolContext(appId, context);
  return seoContext.publishedUrl;
}

/**
 * Published/preview URLs and whether the app has an active publish variant.
 */
export async function resolveSiteSeoContextFromToolContext(
  appId: string,
  context: ToolContextWithSocket | undefined,
): Promise<SiteSeoContext> {
  const socketId = context?.socketId;
  if (!socketId || typeof socketId !== 'string') {
    logger.info('site.seo_context.skipped', { appId, reason: 'no-socket-id' });
    return EMPTY_SITE_SEO_CONTEXT;
  }

  const clientActionService = getActionService(socketId);
  if (!clientActionService) {
    logger.info('site.seo_context.skipped', { appId, reason: 'no-client-action-service' });
    return EMPTY_SITE_SEO_CONTEXT;
  }

  const seoContext = await fetchSiteSeoContextViaGetSiteData(appId, clientActionService);
  logger.info('site.seo_context.resolved', {
    appId,
    isPublished: seoContext.isPublished,
    hasPublishedUrl: Boolean(seoContext.publishedUrl),
    hasPreviewUrl: Boolean(seoContext.previewUrl),
  });
  return seoContext;
}
