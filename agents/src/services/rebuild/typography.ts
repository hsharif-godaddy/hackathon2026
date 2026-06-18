/**
 * Deterministic rebuild typography — binds Atlas-extracted fonts to CSS variables
 * before the develop agent runs (AIROBUILD-2647 / AIROBUILD-2587 P1).
 */
import {
  clampWeightsToAvailable,
  loadGoogleFontsCatalog,
  type FontCategory,
  type FontInfo,
  type GoogleFontEntry,
} from '@airo/shared/fonts';

import { AppRepository } from '../../database/repositories/AppRepository.js';
import { Logger } from '../../logging/index.js';
import { syncBrandTokensCss } from '../design-system/brand-tokens-css.js';
import {
  detectFontCategory,
  persistBrandTypographyToMemory,
  persistFontThemeToPlan,
  updateCssFontVariables,
  validateFontPairing,
} from '../../tools/ai-lib-tools/font-theme.js';
import type { SiteMetadata, StylePreferences } from '../../types/rebuild.js';
import { createForWorkspace } from '../../workspace/index.js';

const logger = Logger.create({ component: 'rebuild-typography' });
const appRepo = new AppRepository();

const GENERIC_FONT_NAMES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'georgia',
  'times new roman',
  'times',
  'arial',
  'helvetica',
  'inherit',
  'initial',
  'unset',
]);

const GENERIC_FONT_CATEGORY: Record<string, FontCategory> = {
  serif: 'serif',
  'ui-serif': 'serif',
  georgia: 'serif',
  'times new roman': 'serif',
  times: 'serif',
  'sans-serif': 'sans-serif',
  'system-ui': 'sans-serif',
  'ui-sans-serif': 'sans-serif',
  arial: 'sans-serif',
  helvetica: 'sans-serif',
  monospace: 'monospace',
  'ui-monospace': 'monospace',
  cursive: 'cursive',
  fantasy: 'fantasy',
  inherit: 'sans-serif',
  initial: 'sans-serif',
  unset: 'sans-serif',
};

export interface FontSubstitution {
  role: 'heading' | 'body';
  requested: string;
  resolved: string;
}

export type ApplyRebuildTypographySkipReason =
  | 'not_applicable'
  | 'no_fonts_detected'
  | 'workspace_unavailable'
  | 'catalog_load_failed'
  | 'validation_failed'
  | 'css_update_failed';

export type ApplyRebuildTypographyResult =
  | {
      applied: true;
      headerFont: string;
      bodyFont: string;
      substitutions?: FontSubstitution[];
    }
  | {
      applied: false;
      reason: ApplyRebuildTypographySkipReason;
      headerFont?: string;
      bodyFont?: string;
      substitutions?: FontSubstitution[];
    };

export function shouldApplyRebuildTypography(
  isFirstPage: boolean,
  stylePreferences: StylePreferences,
  typography: SiteMetadata['typography'],
): boolean {
  if (!isFirstPage || stylePreferences.typographyStyle !== 'keep-original') {
    return false;
  }
  return typography.headingFonts.length > 0 || typography.bodyFonts.length > 0;
}

export function normalizeFontName(name: string): string {
  const withoutControlChars = [...name]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  return withoutControlChars
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function pickSourceFontNames(typography: SiteMetadata['typography']): { heading: string; body: string } | null {
  const heading = typography.headingFonts.map(normalizeFontName).find((n) => n.length > 0);
  const body = typography.bodyFonts.map(normalizeFontName).find((n) => n.length > 0);
  if (!heading && !body) return null;
  const resolved = heading ?? body!;
  return { heading: heading ?? resolved, body: body ?? resolved };
}

function defaultWeights(role: 'heading' | 'body', available: string[]): string[] {
  const preferred = role === 'heading' ? ['400', '500', '600', '700'] : ['400', '500'];
  const availableSet = new Set(available);
  const kept = preferred.filter((w) => availableSet.has(w));
  if (kept.length > 0) return kept;
  if (availableSet.has('400')) return ['400'];
  const sorted = [...available].sort((a, b) => Number(a) - Number(b));
  return sorted.length > 0 ? [sorted[0]!] : ['400'];
}

export function categoryForGenericFontName(normalized: string): FontCategory {
  return GENERIC_FONT_CATEGORY[normalized] ?? 'sans-serif';
}

export function themedCatalogFallback(
  catalog: GoogleFontEntry[],
  category: FontCategory,
): GoogleFontEntry | undefined {
  if (category === 'serif') {
    return catalog.find((entry) => entry.family === 'Lora');
  }
  if (category === 'sans-serif') {
    return catalog.find((entry) => entry.family === 'Inter');
  }
  return catalog.find((entry) => entry.category === category);
}

export function findCatalogFont(
  requested: string,
  catalog: GoogleFontEntry[],
): { entry: GoogleFontEntry; substituted: boolean } {
  const normalized = normalizeFontName(requested).toLowerCase();
  if (!normalized) {
    throw new Error('empty font name');
  }

  const exact = catalog.find((entry) => entry.family.toLowerCase() === normalized);
  if (exact) {
    return { entry: exact, substituted: false };
  }

  if (GENERIC_FONT_NAMES.has(normalized)) {
    const category = categoryForGenericFontName(normalized);
    const themed = themedCatalogFallback(catalog, category);
    if (themed) {
      return { entry: themed, substituted: true };
    }
    const categoryMatch = catalog.find((entry) => entry.category === category);
    if (categoryMatch) {
      return { entry: categoryMatch, substituted: true };
    }
  }

  const partial = catalog.filter(
    (entry) =>
      entry.family.toLowerCase().includes(normalized) ||
      normalized.includes(entry.family.toLowerCase()),
  );
  if (partial.length > 0) {
    partial.sort(
      (a, b) =>
        Math.abs(a.family.length - normalized.length) - Math.abs(b.family.length - normalized.length),
    );
    return { entry: partial[0]!, substituted: true };
  }

  const category = detectFontCategory(requested);
  const themed = themedCatalogFallback(catalog, category);
  if (themed) {
    return { entry: themed, substituted: true };
  }

  const categoryMatch = catalog.find((entry) => entry.category === category);
  if (categoryMatch) {
    return { entry: categoryMatch, substituted: true };
  }

  if (!catalog[0]) {
    throw new Error('Google Fonts catalog is empty');
  }
  return { entry: catalog[0], substituted: true };
}

async function toFontInfo(
  requested: string,
  role: 'heading' | 'body',
  catalog: GoogleFontEntry[],
): Promise<{ font: FontInfo; substitution?: FontSubstitution }> {
  const original = normalizeFontName(requested);
  const { entry, substituted } = findCatalogFont(original, catalog);

  const font: FontInfo = {
    name: entry.family,
    weights: await clampWeightsToAvailable(entry.family, defaultWeights(role, entry.weights)),
    category: entry.category,
  };

  if (substituted || original.toLowerCase() !== entry.family.toLowerCase()) {
    return {
      font,
      substitution: { role, requested: original, resolved: entry.family },
    };
  }
  return { font };
}

export async function applyRebuildTypography(
  appId: string,
  typography: SiteMetadata['typography'],
  stylePreferences: StylePreferences,
  isFirstPage: boolean,
): Promise<ApplyRebuildTypographyResult> {
  if (!shouldApplyRebuildTypography(isFirstPage, stylePreferences, typography)) {
    return { applied: false, reason: 'not_applicable' };
  }

  const sourceNames = pickSourceFontNames(typography);
  if (!sourceNames) {
    return { applied: false, reason: 'no_fonts_detected' };
  }

  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    logger.warn('rebuild.typography.workspace_unavailable', { appId });
    return { applied: false, reason: 'workspace_unavailable' };
  }

  let catalog: GoogleFontEntry[];
  try {
    catalog = await loadGoogleFontsCatalog();
  } catch (error) {
    logger.warn('rebuild.typography.catalog_load_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { applied: false, reason: 'catalog_load_failed' };
  }

  if (catalog.length === 0) {
    logger.warn('rebuild.typography.catalog_empty', { appId });
    return { applied: false, reason: 'catalog_load_failed' };
  }

  let headingResult: { font: FontInfo; substitution?: FontSubstitution };
  let bodyResult: { font: FontInfo; substitution?: FontSubstitution };
  try {
    [headingResult, bodyResult] = await Promise.all([
      toFontInfo(sourceNames.heading, 'heading', catalog),
      toFontInfo(sourceNames.body, 'body', catalog),
    ]);
  } catch (error) {
    logger.warn('rebuild.typography.catalog_resolution_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { applied: false, reason: 'catalog_load_failed' };
  }

  const substitutions = [headingResult.substitution, bodyResult.substitution].filter(
    (s): s is FontSubstitution => s !== undefined,
  );

  for (const sub of substitutions) {
    logger.warn('rebuild.typography.substitution', {
      appId,
      role: sub.role,
      requested: sub.requested,
      resolved: sub.resolved,
    });
  }

  const validation = await validateFontPairing(headingResult.font, bodyResult.font);
  if (!validation.valid && !validation.networkError) {
    logger.error('rebuild.typography.validation_failed', {
      appId,
      headerFont: headingResult.font.name,
      bodyFont: bodyResult.font.name,
    });
    return {
      applied: false,
      reason: 'validation_failed',
      headerFont: headingResult.font.name,
      bodyFont: bodyResult.font.name,
      ...(substitutions.length > 0 ? { substitutions } : {}),
    };
  }
  if (validation.networkError) {
    logger.warn('rebuild.typography.validation_network_error', {
      appId,
      headerFont: headingResult.font.name,
      bodyFont: bodyResult.font.name,
    });
  }

  const cssResult = await updateCssFontVariables(workspace.files, headingResult.font, bodyResult.font);
  if (!cssResult.success) {
    logger.error('rebuild.typography.css_update_failed', {
      appId,
      message: cssResult.message,
    });
    return { applied: false, reason: 'css_update_failed' };
  }

  const themeName =
    headingResult.font.name === bodyResult.font.name
      ? headingResult.font.name
      : `${headingResult.font.name} & ${bodyResult.font.name}`;

  const customerId = appRepo.findById(appId)?.customerId;
  const fontTheme = {
    name: themeName,
    headerFont: headingResult.font,
    bodyFont: bodyResult.font,
  };

  await persistBrandTypographyToMemory(appId, customerId, fontTheme, 'rebuild.typography');
  await persistFontThemeToPlan(appId, fontTheme, 'rebuild.typography');

  try {
    await syncBrandTokensCss(appId, customerId, workspace.files);
  } catch (error) {
    logger.warn('rebuild.typography.brand_tokens_sync_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('rebuild.typography.applied', {
    appId,
    headerFont: headingResult.font.name,
    bodyFont: bodyResult.font.name,
    themeName,
    substitutionCount: substitutions.length,
  });

  return {
    applied: true,
    headerFont: headingResult.font.name,
    bodyFont: bodyResult.font.name,
    ...(substitutions.length > 0 ? { substitutions } : {}),
  };
}
