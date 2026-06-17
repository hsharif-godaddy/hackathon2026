import { Logger } from '../../logging/index.js';
import type { RebuildIntakeChoices, RebuildScope, StylePreferences } from '../../types/rebuild.js';

const logger = Logger.create({ component: 'rebuild-intake-defaults' });

type DesignDirection = StylePreferences['designDirection'];

/** Fallback when intake is skipped, times out, or the feature flag is off */
export const DEFAULT_STYLE_PREFERENCES: StylePreferences = {
  designDirection: 'modernize',
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
 * Resolve design direction: modal/intake metadata, then agent tool arg, then default.
 */
export function resolveDesignDirection(
  clientDirection?: unknown,
  toolDirection?: unknown,
): DesignDirection {
  if (isValidDesignDirection(clientDirection)) return clientDirection;
  if (clientDirection !== undefined && clientDirection !== null) {
    logger.warn('rebuild.intakeDefaults.invalidDirection', { source: 'client', received: clientDirection });
  }
  if (isValidDesignDirection(toolDirection)) return toolDirection;
  if (toolDirection !== undefined && toolDirection !== null) {
    logger.warn('rebuild.intakeDefaults.invalidDirection', { source: 'tool', received: toolDirection });
  }
  return DEFAULT_STYLE_PREFERENCES.designDirection;
}

/**
 * Default style preferences with design direction from client choice, tool arg, or default.
 */
export function stylePreferencesForDirection(
  designDirection?: unknown,
  toolDirection?: unknown,
): StylePreferences {
  return {
    ...DEFAULT_STYLE_PREFERENCES,
    designDirection: resolveDesignDirection(designDirection, toolDirection),
  };
}

export function defaultIntakeChoices(designDirection?: unknown, toolDirection?: unknown): RebuildIntakeChoices {
  return {
    scope: DEFAULT_REBUILD_SCOPE,
    stylePreferences: stylePreferencesForDirection(designDirection, toolDirection),
  };
}
