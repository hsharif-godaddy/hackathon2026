import { logger } from '../logging/index.js';
import type { ResolvedFavicon, SiteFavicon } from '../types/rebuild.js';

/**
 * Normalize a source-site asset filesystem path to its public URL form.
 *
 * Inputs are typed `${.source-site/assets}/<...>` (filesystem-relative); outputs
 * are `/assets/<...>` (servable from the rebuilt app's public root). Backslashes
 * are converted to forward slashes for paths constructed on Windows agents.
 */
export function normalizeAssetPath(localPath: string): string {
  return localPath
    .replace(/\\/g, '/')
    .replace(/^\.source-site\/assets\//, '/assets/');
}

/**
 * Resolve a favicon's source URL to the public path of its already-downloaded
 * asset (favicon-typed assets reach the manifest as `icon` and are downloaded
 * by AssetProcessingService). Falls back to the source URL when no local asset
 * matches — notably Atlas's synthesized implicit `/favicon.ico`, which is never
 * crawled or downloaded.
 */
export function resolveFaviconHref(
  faviconUrl: string,
  assets: ReadonlyArray<{ url: string; localPath: string }>,
): string {
  const match = assets.find(a => a.url === faviconUrl);
  if (match) return normalizeAssetPath(match.localPath);

  // No downloaded asset matched, so we hotlink the source URL. Expected for
  // Atlas's synthesized implicit /favicon.ico, but if it fires for a favicon
  // that *should* have been downloaded it points at URL-normalization skew
  // between the favicon pick and the asset list — log so that's observable.
  logger.debug('rebuild.favicon.resolve.hotlink_fallback', { faviconUrl });
  return faviconUrl;
}

/**
 * Resolve a source {@link SiteFavicon} into an emittable {@link ResolvedFavicon}:
 * re-point its `url` at the downloaded asset's public `href` (or hotlink
 * fallback) and carry the optional `rel`/`sizes`/`mimeType` through. Shared by
 * the page prompt block and the structured `PageBuildSpec` so the two emit
 * sites can't drift.
 */
export function resolveFavicon(
  favicon: SiteFavicon,
  assets: ReadonlyArray<{ url: string; localPath: string }>,
): ResolvedFavicon {
  return {
    href: resolveFaviconHref(favicon.url, assets),
    ...(favicon.rel ? { rel: favicon.rel } : {}),
    ...(favicon.sizes ? { sizes: favicon.sizes } : {}),
    ...(favicon.mimeType ? { mimeType: favicon.mimeType } : {}),
  };
}
