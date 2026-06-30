/**
 * Post-edit handler that keeps the v8 SEO sitemap registry in sync.
 *
 * v8-template-specific coupling: when the agent edits `src/routes.tsx`, mirror
 * the registered static paths into `src/lib/seo-routes.ts` (the registry
 * consumed by `/sitemap.xml`). This lives next to `SeoRoutesSynchronizer` —
 * where the template knowledge belongs — and is wired into the text editor via
 * the generic post-edit handler registry, so the editor itself stays
 * template-agnostic. If the v8 template changes how routes are declared, update
 * this handler and `SeoRoutesSynchronizer` together.
 */

import { join } from 'node:path';

import { logger } from '../logging/index.js';
import type {
  PostEditContext,
  PostEditHandler,
} from '../tools/ai-lib-tools/post-edit-handlers.js';
import { invalidateSeoAuditCache } from './seo-audit.js';
import { synchronizeSeoRoutes } from './SeoRoutesSynchronizer.js';

const ROUTES_REL_PATH = join('src', 'routes.tsx');

export const seoRoutesPostEditHandler: PostEditHandler = {
  name: 'seo-routes-sync',

  // Because the runner derives relPath from the already-resolved fullPath, this
  // correctly handles all the LLM path forms iter-2 flagged: `./src/routes.tsx`,
  // `/app/src/routes.tsx` (Docker-prefix stripped by translateDockerPath),
  // absolute host paths, and trailing slash variants.
  matches(relPath: string): boolean {
    return relPath === ROUTES_REL_PATH;
  },

  async run(context: PostEditContext, result: string): Promise<string> {
    const { appPath, appId, filePath } = context;

    let syncResult: Awaited<ReturnType<typeof synchronizeSeoRoutes>>;
    try {
      syncResult = await synchronizeSeoRoutes(appId);
    } catch (error) {
      invalidateSeoAuditCache(appId);
      // synchronizeSeoRoutes returns status:'skipped' for parse / non-literal-routes
      // cases, so anything that throws here is a real failure — a workspace that
      // can't be bound, or a non-not_found transport error re-thrown from a
      // file op. Log at error level — these need investigation, unlike skips.
      logger.error('seo.routes.sync.error', {
        appPath,
        appId,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return `${result}\nSEO sync failed: ${error instanceof Error ? error.message : String(error)} — verify src/lib/seo-routes.ts is up to date.`;
    }
    invalidateSeoAuditCache(appId);
    logger.info(`seo.routes.sync.${syncResult.status}`, {
      appPath,
      appId,
      filePath,
      reason: syncResult.status === 'skipped' ? syncResult.reason : undefined,
      routeCount: syncResult.routes.length,
      warnings: syncResult.warnings,
    });

    // Surface skip reasons and warnings to the agent so it can self-correct on
    // the next turn. Without this the str_replace looks clean even when sync
    // silently skipped or curated metadata was lost.
    const notes: string[] = [];
    if (syncResult.status === 'synced') {
      notes.push('SEO: synced static routes into src/lib/seo-routes.ts. Do not edit seo-routes.ts unless adjusting priority/changefreq/lastmod.');
    } else {
      // Pick a tailored hint per skip reason. The empty-paths case parsed cleanly,
      // so suggesting "verify routes.tsx parses" would mislead the agent.
      const isEmptyPathsCase = syncResult.reason.startsWith('no static routes parsed');
      const hint = isEmptyPathsCase
        ? 'add a literal `path: "/..."` string to a route in routes.tsx (template literals and identifier refs are not statically resolvable)'
        : 'verify routes.tsx parses and exports a literal routes array';
      notes.push(`SEO sync skipped: ${syncResult.reason} — ${hint}.`);
    }
    if (syncResult.warnings.length > 0) {
      notes.push(`SEO sync warnings: ${syncResult.warnings.join('; ')}`);
    }

    return `${result}\n${notes.join('\n')}`;
  },
};
