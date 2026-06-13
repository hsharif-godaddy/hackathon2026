import { Logger } from '../../logging/index.js';
import type { RebuildIntakeChoices, RebuildScope, StylePreferences } from '../../types/rebuild.js';

const logger = Logger.create({ component: 'rebuild-intake-defaults' });

type DesignDirection = StylePreferences['designDirection'];

/** Fallback when intake is skipped, times out, or the feature flag is off */
export const DEFAULT_STYLE_PREFERENCES: StylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
};

export const DEFAULT_REBUILD_SCOPE: RebuildScope = 'homepage_only';

/** Client-supplied direction is untrusted — narrow it before use. */
export function isValidDesignDirection(value: unknown): value is DesignDirection {
  return value === 'keep-similar' || value === 'modernize' || value === 'simplify' || value === 'bold';
}

/**
 * Default style preferences with the design direction overridden by the
 * homepage modal choice when present and valid (keep-similar otherwise).
 */
export function stylePreferencesForDirection(designDirection?: unknown): StylePreferences {
  if (isValidDesignDirection(designDirection)) {
    return { ...DEFAULT_STYLE_PREFERENCES, designDirection };
  }
  // A choice arrived but didn't validate (client drift / typo'd enum) — falling back
  // to keep-similar would silently turn a reimagine into a clone, so make it debuggable.
  // The common no-choice case (undefined/null) is not an error.
  if (designDirection !== undefined && designDirection !== null) {
    logger.warn('rebuild.intakeDefaults.invalidDirection', { received: designDirection });
  }
  return DEFAULT_STYLE_PREFERENCES;
}

export function defaultIntakeChoices(designDirection?: unknown): RebuildIntakeChoices {
  return {
    scope: DEFAULT_REBUILD_SCOPE,
    stylePreferences: stylePreferencesForDirection(designDirection),
  };
}
