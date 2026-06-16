import { Logger } from '../../logging/index.js';
import type { RebuildIntakeChoices, RebuildScope, StylePreferences } from '../../types/rebuild.js';

const logger = Logger.create({ component: 'rebuild-intake-defaults' });

type DesignDirection = StylePreferences['designDirection'];

type InferredDirection = Extract<DesignDirection, 'keep-similar' | 'modernize'>;

/** Fallback when intake is skipped, times out, or the feature flag is off */
export const DEFAULT_STYLE_PREFERENCES: StylePreferences = {
  designDirection: 'modernize',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
};

export const DEFAULT_REBUILD_SCOPE: RebuildScope = 'homepage_only';

const CLONE_INTENT_PATTERN =
  /\b(keep\s+similar|keep\s+(a\s+)?similar|same\s+(overall\s+)?look|keep\s+my\s+current\s+look|keep\s+it\s+as[- ]?is|faithful\s+clone|copycat|clone\s+my|mirror\s+my|reproduce\s+the\s+source)\b/gi;

const MODERNIZE_INTENT_PATTERN =
  /\b(modernize|reimagine|redesign|fresh\s+modern|updated?\s+design|refresh(?:ed)?\s+(?:the\s+)?(?:design|look|style|layout))\b/gi;

/** Negation cue immediately before an intent phrase (don't / not a / not interested in a …). */
const NEGATION_BEFORE_MATCH =
  /\b(?:don'?t|do not|not|no)(?:\s+(?:(?:want(?:\s+to)?|interested\s+in)(?:\s+(?:a|the))?\s*|\s*(?:a|the)\s*))?$/i;

const NEGATION_LOOKBACK_CHARS = 80;

/** Client-supplied direction is untrusted — narrow it before use. */
export function isValidDesignDirection(value: unknown): value is DesignDirection {
  return value === 'keep-similar' || value === 'modernize' || value === 'simplify' || value === 'bold';
}

function oppositeDirection(direction: InferredDirection): InferredDirection {
  return direction === 'keep-similar' ? 'modernize' : 'keep-similar';
}

function isNegatedAt(message: string, matchStart: number): boolean {
  const prefix = message.slice(0, matchStart).trimEnd();
  return NEGATION_BEFORE_MATCH.test(prefix.slice(Math.max(0, prefix.length - NEGATION_LOOKBACK_CHARS)));
}

function inferFromPattern(
  message: string,
  pattern: RegExp,
  direction: InferredDirection,
): InferredDirection | undefined {
  const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const match = matcher.exec(message);
  while (match) {
    return isNegatedAt(message, match.index) ? oppositeDirection(direction) : direction;
  }
  return undefined;
}

/** Infer design direction from free-text rebuild prompts when no structured choice exists. */
export function inferDesignDirectionFromMessage(message: unknown): DesignDirection | undefined {
  if (typeof message !== 'string' || !message.trim()) return undefined;
  return inferFromPattern(message, CLONE_INTENT_PATTERN, 'keep-similar')
    ?? inferFromPattern(message, MODERNIZE_INTENT_PATTERN, 'modernize');
}

/**
 * Resolve design direction: explicit client choice, then prompt keywords, then default.
 */
export function resolveDesignDirection(clientDirection?: unknown, userMessage?: unknown): DesignDirection {
  if (isValidDesignDirection(clientDirection)) return clientDirection;
  if (clientDirection !== undefined && clientDirection !== null) {
    logger.warn('rebuild.intakeDefaults.invalidDirection', { received: clientDirection });
  }
  const inferred = inferDesignDirectionFromMessage(userMessage);
  if (inferred) return inferred;
  return DEFAULT_STYLE_PREFERENCES.designDirection;
}

/**
 * Default style preferences with design direction from client choice, user message, or default.
 */
export function stylePreferencesForDirection(
  designDirection?: unknown,
  userMessage?: unknown,
): StylePreferences {
  return { ...DEFAULT_STYLE_PREFERENCES, designDirection: resolveDesignDirection(designDirection, userMessage) };
}

export function defaultIntakeChoices(designDirection?: unknown, userMessage?: unknown): RebuildIntakeChoices {
  return {
    scope: DEFAULT_REBUILD_SCOPE,
    stylePreferences: stylePreferencesForDirection(designDirection, userMessage),
  };
}
