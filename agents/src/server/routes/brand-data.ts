/**
 * Brand Data Routes
 *
 * Assembles brand data from the memory table and app DB for the Brand Book view.
 * Logos are served from media slots (not memory) — see useMediaManifest hook.
 * Prefers structured data from brand.identity and brand.colors.palette keys.
 * Falls back to parsed design.* markdown keys for legacy data.
 */

import { Router, Request, Response } from 'express';
import { log } from '../../logging/index.js';
import { getKvMemoryStore } from '../../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
import { getBrandMoodImages } from '../../services/media/brand-mood-images.js';
import { AppMetadataRepository } from '../../database/index.js';
import type { DesignKitRef } from '../../types/design-kit.js';
import { resolveDesignSystemAssetUrl } from '../../services/design-system/catalog.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import {
  parseBrandPersonality,
  parseBrandVoice,
  extractTagline,
  parseBrandIconography,
  parseBrandLayout,
  parseBrandAudience,
  type BrandData,
  type BrandDataPalette,
  type BrandDataTypography,
} from '../../utils/brand-data-parsers.js';

interface BrandIdentityData {
  brandName?: string;
  personality?: BrandData['personality'];
  voice?: BrandData['voice'];
  tagline?: string;
  iconography?: BrandData['iconography'];
  layout?: BrandData['layout'];
  audience?: BrandData['audience'];
  photography?: BrandData['photography'];
  mission?: BrandData['mission'];
  toneMatrix?: Array<{
    context: string;
    tone: string;
    examples?: string[];
    description?: string;
    language?: string;
    purpose?: string;
  }>;
}

const router: Router = Router();
const memory = getKvMemoryStore();

/**
 * GET /apps/:id/brand-data
 * Assembles brand data from memory table + app DB.
 */
router.get('/apps/:id/brand-data', validateAppOwnership, async (req: Request, res: Response): Promise<void> => {
  const { id: appId } = req.params;
  const contextLogger = log.forApp(appId!);

  try {
    const customerId = (req as AuthenticatedRequest).agentContext?.customerId;
    const scope = workspaceScopeFromAppId(appId!, customerId);
    const [
      paletteResult, typographyResult, identityResult,
      personalityResult, voiceResult, iconographyResult, layoutResult, audienceResult,
      summaryResult, imageryResult, wizardResult, moodImages,
    ] = await Promise.all([
      memory.get(scope, 'brand.colors.palette'),
      memory.get(scope, 'brand.typography'),
      memory.get(scope, 'brand.identity'),
      memory.get(scope, 'design.brand-personality'),
      memory.get(scope, 'design.voice-messaging'),
      memory.get(scope, 'design.iconography'),
      memory.get(scope, 'design.layout'),
      memory.get(scope, 'design.audience'),
      memory.get(scope, 'brand.summary'),
      memory.get(scope, 'brand.imagery'),
      memory.get(scope, 'brand.wizard.phase'),
      getBrandMoodImages(appId!),
    ]);

    // Log memory read failures so DB issues surface in monitoring
    const allResults = [
      { key: 'brand.colors.palette', result: paletteResult },
      { key: 'brand.typography', result: typographyResult },
      { key: 'brand.identity', result: identityResult },
      { key: 'design.brand-personality', result: personalityResult },
      { key: 'design.voice-messaging', result: voiceResult },
      { key: 'design.iconography', result: iconographyResult },
      { key: 'design.layout', result: layoutResult },
      { key: 'design.audience', result: audienceResult },
      { key: 'brand.summary', result: summaryResult },
      { key: 'brand.imagery', result: imageryResult },
      { key: 'brand.wizard.phase', result: wizardResult },
    ];
    for (const { key, result } of allResults) {
      if (!result.success) {
        contextLogger.warn('brandData.route.memoryRead.failed', { appId, key, error: result.error });
      }
    }

    // The chosen design kit is sourced from app metadata (`designKit`), written
    // by the catalog-install tool and the ui-kit upload route — the single source
    // of truth for the wizard's "Design kit" row. Best-effort: a metadata read
    // failure degrades the kit row to empty, it never fails the brand-data response.
    let designKit: DesignKitRef | undefined;
    try {
      designKit = new AppMetadataRepository().get(appId!).designKit as DesignKitRef | undefined;
    } catch (err) {
      contextLogger.warn('brandData.route.designKit.read.failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const identity = identityResult.exists ? identityResult.value as BrandIdentityData : null;

    const brandData: BrandData = {
      version: 2,
      brandName: identity?.brandName ?? 'Your Brand',
      palette: paletteResult.exists ? paletteResult.value as BrandDataPalette : undefined,
      typography: typographyResult.exists ? typographyResult.value as BrandDataTypography : undefined,
      // Prefer structured identity data, fall back to parsed markdown
      personality: identity?.personality
        ?? (personalityResult.exists && typeof personalityResult.value === 'string'
          ? parseBrandPersonality(personalityResult.value) : undefined),
      voice: identity?.voice
        ?? (voiceResult.exists && typeof voiceResult.value === 'string'
          ? parseBrandVoice(voiceResult.value) : undefined),
      tagline: identity?.tagline
        ?? (voiceResult.exists && typeof voiceResult.value === 'string'
          ? extractTagline(voiceResult.value) : undefined),
      iconography: identity?.iconography
        ?? (iconographyResult.exists && typeof iconographyResult.value === 'string'
          ? parseBrandIconography(iconographyResult.value) : undefined),
      layout: identity?.layout
        ?? (layoutResult.exists && typeof layoutResult.value === 'string'
          ? parseBrandLayout(layoutResult.value) : undefined),
      audience: identity?.audience
        ?? (audienceResult.exists && typeof audienceResult.value === 'string'
          ? parseBrandAudience(audienceResult.value) : undefined),
      photography: identity?.photography,
      mission: identity?.mission,
      toneMatrix: identity?.toneMatrix ? { contexts: identity.toneMatrix } : undefined,
      summary: summaryResult.exists ? summaryResult.value as BrandData['summary'] : undefined,
      // Merge the keyword (from memory) with the mood-image set (from the media
      // manifest) so both halves of "imagery" come back in one field.
      imagery: ((): BrandData['imagery'] => {
        const base = imageryResult.exists ? imageryResult.value as BrandData['imagery'] : undefined;
        if (!base && moodImages.length === 0) return undefined;
        return { ...(base ?? {}), ...(moodImages.length > 0 ? { moodImages } : {}) };
      })(),
      wizard: ((): BrandData['wizard'] => {
        // Validate the opaque memory value before trusting it as a phase (mirrors
        // the SSE/route guards); an unknown value degrades to no wizard field.
        const phase = wizardResult.exists ? (wizardResult.value as { phase?: unknown }).phase : undefined;
        return phase === 'gathering' || phase === 'brand' || phase === 'website' || phase === 'ready' ? { phase } : undefined;
      })(),
      // Surface the kit's shape language + full-page preview (AIROBUILD-3232 item 7)
      // so the website-build animation mirrors the chosen kit. Each field is only
      // included when stamped; previewPath is resolved to an absolute URL.
      kit: designKit?.displayName
        ? {
            name: designKit.displayName,
            ...(designKit.tokens ? { tokens: designKit.tokens } : {}),
            ...(designKit.previewPath ? { previewUrl: resolveDesignSystemAssetUrl(designKit.previewPath) } : {}),
          }
        : undefined,
    };

    res.json(brandData);
  } catch (error) {
    log.error(contextLogger, 'brandData.route.read.failed', error as Error, { appId });
    res.status(500).json({ error: 'Failed to read brand data' });
  }
});

export default router;
