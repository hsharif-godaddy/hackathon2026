import type { RebuildIntakeChoices, RebuildScope, StylePreferences } from '../../types/rebuild.js';

/** Fallback when intake is skipped, times out, or the feature flag is off */
export const DEFAULT_STYLE_PREFERENCES: StylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
};

export const DEFAULT_REBUILD_SCOPE: RebuildScope = 'homepage_only';

export function defaultIntakeChoices(): RebuildIntakeChoices {
  return {
    scope: DEFAULT_REBUILD_SCOPE,
    stylePreferences: DEFAULT_STYLE_PREFERENCES,
  };
}
