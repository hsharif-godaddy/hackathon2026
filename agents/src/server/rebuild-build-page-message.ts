import { AppRepository } from '../database/repositories/AppRepository.js';
import { Logger } from '../logging/index.js';
import { RebuildOrchestrationService } from '../services/RebuildOrchestrationService.js';
import type { BuildPageResult } from '../services/rebuild/prompt-builder.js';

const logger = Logger.create({ component: 'rebuild-build-page-message' });

// Module-level instance (matches ai-lib-websocket-server.ts) — avoids
// constructing a fresh AppRepository on every rebuild-build message.
const appRepo = new AppRepository();

export interface RebuildBuildPageConfirmation {
  pageSlug: string;
  pageTitle: string;
  sourceUrl: string;
  imageCount: number;
}

export interface RebuildBuildPageResolution {
  prompt: string;
  confirmation: RebuildBuildPageConfirmation;
}

export interface RebuildBuildPageDeps {
  /** Resolve an app's filesystem path from its id (undefined if unknown). */
  findAppPath: (appId: string) => string | undefined;
  /** Build the source-based prompt for a rebuild page and return source metadata. */
  buildPage: (
    appPath: string,
    appId: string,
    slug: string,
  ) => Promise<Pick<BuildPageResult, 'prompt' | 'sourceUrl' | 'pageTitle' | 'imageCount'>>;
}

const defaultDeps: RebuildBuildPageDeps = {
  findAppPath: appId => appRepo.findById(appId)?.path,
  buildPage: (appPath, appId, slug) =>
    new RebuildOrchestrationService(appPath).buildPageDetailed(appId, slug),
};

/**
 * `getEffectiveAgentMessage` implementation for the rebuild "Build Page" widget.
 *
 * When the client sends `context.metadata.rebuildBuildPageSlug`, build that
 * page's prompt from the scraped source server-side and return it, so the
 * develop turn runs deterministically off the source content + imported assets
 * instead of depending on the agent choosing to call `rebuildPageSelector`
 * (which it does unreliably). Returns `undefined` — meaning "leave the message
 * unchanged, run a normal turn" — when this isn't a rebuild-build message, when
 * required metadata is absent, or on any failure (e.g. the page's source JSON is
 * missing). The caller treats a thrown error the same way, but we swallow here
 * to keep the fallback explicit and logged.
 */
export async function resolveRebuildBuildPagePrompt(
  context: Record<string, unknown> | undefined,
  deps: RebuildBuildPageDeps = defaultDeps
): Promise<RebuildBuildPageResolution | undefined> {
  const metadata = (context as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  const slug = metadata?.rebuildBuildPageSlug;
  if (typeof slug !== 'string' || slug.length === 0) return undefined;

  const appId = metadata?.appId;
  if (typeof appId !== 'string' || appId.length === 0) {
    logger.warn('rebuild.build_page.substitution_skipped', { reason: 'missing appId', slug });
    return undefined;
  }

  try {
    // findAppPath stays inside the try so a repository throw is swallowed too —
    // honoring the "undefined on any failure" contract. Without this, the SSE
    // caller (which only handles a returned undefined via `?? content`) would
    // fail the whole turn on a DB throw, while WS would fall back. Same failure,
    // divergent outcome.
    const appPath = deps.findAppPath(appId);
    if (!appPath) {
      logger.warn('rebuild.build_page.substitution_skipped', { reason: 'unknown app path', appId, slug });
      return undefined;
    }

    const built = await deps.buildPage(appPath, appId, slug);
    logger.info('rebuild.build_page.deterministic_substitution', {
      appId,
      slug,
      promptLength: built.prompt.length,
      imageCount: built.imageCount,
    });
    return {
      prompt: built.prompt,
      confirmation: {
        pageSlug: slug,
        pageTitle: built.pageTitle,
        sourceUrl: built.sourceUrl,
        imageCount: built.imageCount,
      },
    };
  } catch (error) {
    // error (not warn): a thrown buildPage is a genuine failed deterministic
    // rebuild that silently degrades to the original user message (no card, no
    // analytics). Logging at error makes it reachable in Sentry rather than
    // blending into routine warns. The `substitution_skipped` cases above stay
    // warn — they're expected absences (no slug / missing app), not failures.
    logger.error('rebuild.build_page.substitution_failed', {
      appId,
      slug,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
