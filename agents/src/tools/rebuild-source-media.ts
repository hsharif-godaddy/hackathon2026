/**
 * Rebuild-aware media slotting (AIROBUILD-2104 follow-on).
 *
 * During the INITIAL build of a rebuilt site, the develop agent still reaches
 * for the `media` tool to fill every image slot — but a faithful clone must use
 * the customer's OWN scraped photos, not Getty stock. Rather than remove the
 * tool (which left slots empty), we intercept the call: match the agent's slot +
 * query against the scraped source images (which already carry vision
 * `description`s and a `usageContext` role) and write the best-matching source
 * image into the slot manifest in the same shape a Getty result would take. The
 * agent gets back the usual `/airo-assets/...` slot URL, the swap UX still works
 * (alternatives are the customer's other photos), and Getty is used only when no
 * source image is available.
 *
 * Active only while `initialBuildComplete` is false and a source manifest with
 * images exists — normal post-build editing keeps full Getty search.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { AppRepository } from '../database/repositories/AppRepository.js';
import { logger } from '../logging/index.js';
import {
  mediaManifestService,
  type MediaManifest,
  type MediaSlot,
} from '../services/MediaManifestService.js';
import type { MediaSlotResult } from './media-slot-tool.js';
import { normalizeAssetPath } from '../utils/asset-paths.js';
import { isRebuildHomepage } from '../utils/rebuild-utils.js';

const appRepo = new AppRepository();

/** Thrown inside the setSlot builder to abort without writing a slot to the manifest. */
class SourceMissError extends Error {
  constructor(public readonly candidateCount: number) {
    super('no source image matched');
  }
}

interface ImagePlacementSignals {
  inHeader?: boolean;
  inFooter?: boolean;
  inFirstSection?: boolean;
  nearH1?: boolean;
  isFirstInContainer?: boolean;
  linkedTo?: string;
}

interface SourceImageAsset {
  localPath: string;
  type?: string;
  usageContext?: string | null;
  description?: string | null;
  alt?: string | null;
  dimensions?: { width: number; height: number } | null;
  sourcePages?: string[];
  /** Atlas SSM placement — where the image sat on the source page. */
  placement?: ImagePlacementSignals | null;
}

export interface RebuildBuildContext {
  appPath: string;
  rootPath: string;
  /** Bring-over images toggle. When false (Reimagine / keepImages off), source
   * photos must NOT be served — slots fall through to fresh imagery. Defaults to
   * true for legacy manifests written before the toggle existed. */
  keepSourceImages: boolean;
}

/**
 * Returns the rebuild context when `appId` is a rebuilt site still in its initial
 * build, else null (non-rebuild app, post-build editing, PaaS app with no local
 * record, or any lookup failure — all leave Getty search untouched).
 */
export async function getRebuildBuildContext(appId: string | undefined): Promise<RebuildBuildContext | null> {
  if (!appId) return null;
  try {
    const app = appRepo.findById(appId);
    if (!app || app.initialBuildComplete) return null;
    const stateRaw = await readFile(path.join(app.path, '.source-site', 'workflow-state.json'), 'utf-8');
    const state = JSON.parse(stateRaw) as { rootPath?: string; stylePreferences?: { keepSourceImages?: boolean } };
    return {
      appPath: app.path,
      rootPath: state.rootPath ?? '/',
      keepSourceImages: state.stylePreferences?.keepSourceImages ?? true,
    };
  } catch (error: unknown) {
    const isNotFound = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (!isNotFound) {
      logger.warn('media-slot.rebuild-context-error', { appId, error: error instanceof Error ? error.message : String(error) });
    }
    return null;
  }
}

async function loadSourceImages(appPath: string): Promise<SourceImageAsset[]> {
  const raw = await readFile(path.join(appPath, '.source-site', 'assets', 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(raw) as { assets?: SourceImageAsset[] };
  return (manifest.assets ?? []).filter(a => a.type === 'image');
}

// ----- Pure matching (no I/O — unit-tested directly) ---------------------

const STOP_WORDS = new Set([
  'the', 'and', 'with', 'for', 'are', 'this', 'that', 'featuring', 'showing',
  'appears', 'displays', 'image', 'images', 'photo', 'photograph', 'background',
  'side', 'left', 'right', 'against',
]);

/** Basename of an asset URL/path, the stable identity used for dedup across URL forms. */
function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

/**
 * Convert a source image's public `/assets/...` path to the slot `currentUrl`
 * form dev-supervisor can actually serve. The image-slot handler only serves a
 * local file when `currentUrl` is `/airo-assets/uploads/{filename}` (it searches
 * the shared-storage asset dirs, which include `.../images`); a bare `/assets/`
 * currentUrl is rejected as an invalid redirect target. The basename is a
 * content hash, unique across asset dirs, so the flat filename resolves cleanly.
 */
export function toServableSlotUrl(assetUrl: string): string {
  return `/airo-assets/uploads/${basename(assetUrl)}`;
}

export function tokenize(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t)),
  );
}

/** Source-image roles preferred for a given slot path (by keyword). */
function preferredContexts(slot: string): string[] {
  if (/logo|brand|nav|header|footer/.test(slot)) return ['logo'];
  if (/team|chef|staff|about|profile|founder|portrait|person|people/.test(slot)) return ['profile', 'content'];
  if (/hero|banner/.test(slot)) return ['hero', 'content'];
  return ['content', 'hero', 'profile'];
}

/** A prominent slot wants the full-bleed hero/banner image — the biggest real photo. */
function isProminentSlot(slot: string): boolean {
  return /hero|banner/.test(slot);
}

/**
 * Size tier for a prominent-slot candidate. The full-bleed header is the largest
 * image on the page, and Atlas placement here covers only small lazy-load DOM
 * placeholders — so megapixels are the reliable "this is the big one" signal.
 */
function sizeTier(dimensions: { width: number; height: number } | null | undefined): number {
  const mp = ((dimensions?.width ?? 0) * (dimensions?.height ?? 0)) / 1_000_000;
  if (mp >= 1.5) return 16;
  if (mp >= 0.5) return 8;
  if (mp >= 0.2) return 4;
  return 1;
}

/** Pathname tokens of a linkedTo href (absolute or relative), for slot↔card matching. */
function linkedToTokens(href: string | undefined): Set<string> {
  if (!href) return new Set();
  try {
    const path = new URL(href, 'https://x.invalid').pathname;
    return tokenize(path.replace(/[/-]/g, ' '));
  } catch {
    return new Set();
  }
}

/**
 * Score how well an image's source-page placement fits the slot. Placement is
 * the strongest section signal: a hero slot wants the image that sat in the
 * first section, a named card slot wants the image that linked to that page.
 */
function scorePlacement(
  placement: ImagePlacementSignals | null | undefined,
  slot: string,
  slotTokens: Set<string>,
): number {
  if (!placement) return 0;
  let score = 0;
  // Hero bonus only for an explicit hero/banner slot — otherwise the first-section
  // image would outscore a named card on its own slot.
  if (/hero|banner/.test(slot) && (placement.inFirstSection || placement.nearH1)) score += 5;
  if (/footer/.test(slot) && placement.inFooter) score += 5;
  // A card image that links to /classes should win the "classes" slot.
  const linkTokens = linkedToTokens(placement.linkedTo);
  for (const t of slotTokens) if (linkTokens.has(t)) score += 4;
  return score;
}

/**
 * Pick the best source image for a slot+query from `candidates`, skipping any
 * URL already used by another slot. Logos only fill logo-ish slots (and vice
 * versa). Falls back to the largest unused candidate when no text/context signal
 * matches — a real photo always beats stock for a faithful clone. Returns null
 * only when the candidate pool is empty after filtering.
 */
export function selectSourceImageForSlot(
  candidates: SourceImageAsset[],
  slot: string,
  query: string,
  usedUrls: Set<string>,
): { url: string; alternatives: string[] } | null {
  const preferred = preferredContexts(slot);
  const wantsLogo = preferred.includes('logo');
  const queryTokens = tokenize(query);
  const slotTokens = tokenize(slot.replace(/[/-]/g, ' '));

  // A logo is signalled by either the vision usageContext or sitting in the
  // page header. Logos only fill logo slots; content slots never get the logo,
  // and a logo slot never gets a content photo.
  const isLogoish = (asset: SourceImageAsset): boolean =>
    asset.usageContext === 'logo' || asset.placement?.inHeader === true;

  // Dedup by basename so a slot isn't reused regardless of the URL form already
  // recorded in the manifest (/assets/… vs /airo-assets/uploads/…).
  const usedBasenames = new Set([...usedUrls].map(basename));
  const pool = candidates
    .map(a => ({ asset: a, url: normalizeAssetPath(a.localPath) }))
    .filter(({ asset, url }) => !usedBasenames.has(basename(url)) && isLogoish(asset) === wantsLogo);

  if (pool.length === 0) return null;

  const prominent = isProminentSlot(slot);
  const scored = pool
    .map(({ asset, url }) => {
      const description = `${asset.description ?? ''} ${asset.alt ?? ''}`.trim();
      const descTokens = tokenize(description);
      let textScore = 0;
      for (const t of queryTokens) if (descTokens.has(t)) textScore++;
      const contextBonus = asset.usageContext && preferred.includes(asset.usageContext) ? 2 : 0;
      const placementScore = scorePlacement(asset.placement, slot, slotTokens);
      const area = (asset.dimensions?.width ?? 0) * (asset.dimensions?.height ?? 0);

      // Prominent slots: size dominates and query text is only a minor nudge; an
      // undescribed DOM placeholder (lazy-load stand-in) must not win the hero.
      // Other slots keep query/description matching as the primary signal.
      const score = prominent
        ? (description ? sizeTier(asset.dimensions) : -10) + placementScore + contextBonus + textScore
        : textScore * 3 + contextBonus + placementScore;
      return { url, score, area };
    })
    .sort((a, b) => b.score - a.score || b.area - a.area);

  const best = scored[0]!;
  return { url: best.url, alternatives: scored.slice(1, 6).map(s => s.url) };
}

// ----- Integration: fill a slot from source, mirroring selectMedia's write ---

/**
 * Try to fill `slot` from the scraped source images. Returns a MediaSlotResult
 * (same shape as a Getty selection) when a source image is chosen, or null to
 * signal the caller should fall through to Getty (not a rebuild build, no
 * candidate image, or a manifest write failure).
 */
export async function fillSlotFromRebuildSource(opts: {
  appId: string;
  slot: string;
  query: string;
  mediaType: 'image' | 'video';
}): Promise<MediaSlotResult | null> {
  // Source manifests carry images only; videos always fall through to Getty.
  if (opts.mediaType !== 'image') return null;

  const ctx = await getRebuildBuildContext(opts.appId);
  if (!ctx) return null;

  // keepImages off (Reimagine): do not serve scraped photos — let the slot fall
  // through to fresh imagery. This is the runtime half of the images lever; the
  // prompt-manifest filter (selectPromptAssets) only controls what the agent sees.
  if (!ctx.keepSourceImages) {
    logger.info('rebuild.source-fill.skipped-keepimages-off', { appId: opts.appId, slot: opts.slot });
    return null;
  }

  const normalizedSlot = opts.slot.trim().replace(/^\/+|\/+$/g, '');
  const logContext = { appId: opts.appId, slot: normalizedSlot, query: opts.query };

  try {
    const allImages = await loadSourceImages(ctx.appPath);
    // Home slots prefer images that actually appeared on the homepage (so an
    // inner-page-only photo can't displace a real homepage one). Overflow — more
    // slots than distinct homepage photos — broadens to the whole site, which is
    // correct for a gallery drawing from the brand's own food photos site-wide.
    const homeImages = normalizedSlot.startsWith('pages/home')
      ? allImages.filter(a => (a.sourcePages ?? []).some(u => isRebuildHomepage(u, ctx.rootPath)))
      : [];
    const primaryPool = homeImages.length > 0 ? homeImages : allImages;

    // The builder closure runs under MediaManifestService's lock, so concurrent
    // slot fills each see the latest committed manifest when computing usedUrls.
    // This prevents two parallel media tool calls from picking the same image.
    const now = new Date().toISOString();
    const buildSlot = (manifest: MediaManifest): MediaSlot => {
      const usedUrls = new Set<string>();
      for (const entry of Object.values(manifest)) {
        if (entry?.currentUrl) usedUrls.add(entry.currentUrl);
      }

      const pick =
        selectSourceImageForSlot(primaryPool, normalizedSlot, opts.query, usedUrls)
        ?? selectSourceImageForSlot(allImages, normalizedSlot, opts.query, usedUrls)
        ?? selectSourceImageForSlot(allImages, normalizedSlot, opts.query, new Set());

      if (!pick) {
        throw new SourceMissError(allImages.length);
      }

      return {
        mediaType: 'image',
        currentUrl: toServableSlotUrl(pick.url),
        searchQuery: opts.query,
        alternatives: pick.alternatives.map(toServableSlotUrl),
        userModified: false,
        createdAt: now,
        lastUpdated: now,
      };
    };

    // skipGitCommit: rebuild selections are auto-committed in batches, matching selectMedia.
    const writeResult = await mediaManifestService.setSlot(opts.appId, normalizedSlot, buildSlot, true);
    if (!writeResult.success || !writeResult.builtSlot) {
      logger.warn('media-slot.source-write-failed', { ...logContext, error: writeResult.error });
      return null;
    }

    logger.info('media-slot.source-fill', {
      ...logContext,
      chosen: writeResult.builtSlot.currentUrl,
      alternativeCount: writeResult.builtSlot.alternatives.length,
    });

    return {
      success: true,
      slot: normalizedSlot,
      slotUrl: `/airo-assets/images/${normalizedSlot}`,
      mediaType: 'image',
      searchQuery: opts.query,
      resolvedUrl: writeResult.builtSlot.currentUrl,
      alternatives: writeResult.builtSlot.alternatives,
      alternativeCount: writeResult.builtSlot.alternatives.length,
    };
  } catch (error) {
    if (error instanceof SourceMissError) {
      logger.info('media-slot.source-miss', { ...logContext, candidateCount: error.candidateCount });
      return null;
    }
    logger.warn('media-slot.source-fill-error', {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
