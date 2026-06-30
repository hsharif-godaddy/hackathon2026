import { createHash } from 'node:crypto';

import { trace } from '@opentelemetry/api';

import { ROLLOUTS, type FeatureRolloutDefinition, type FeatureRolloutName } from '../config/feature-rollouts.js';
import { getSwitchboardValue } from '../services/switchboard.js';

// Switchboard's SwitchboardCriteria only exposes { shopperId } — shopper/user-level
// targeting. appId is a deployment identifier with no Switchboard-native percentage
// rollout by arbitrary string ID. The SHA-256 bucketer provides stable, independent
// cohort assignment per (featureName, appId) pair. Switchboard's rollout.* flags are
// used solely for operator overrides at runtime (no redeploy required).
const ROLLOUTS_MAP = ROLLOUTS as Record<string, FeatureRolloutDefinition | undefined>;

/**
 * Returns true when the given feature rollout is enabled for the specified appId.
 *
 * Resolution order:
 *   1. Switchboard flag `rollout.<featureName>` (number) — operators can flip this at
 *      runtime without a redeploy. Value 0 = disabled, 1–100 = enabled at that percent.
 *      The Switchboard default should be -1, which means "no override — use code config".
 *   2. ROLLOUTS registry (`src/config/feature-rollouts.ts`) — the code-level default.
 *      The feature must be registered here to be usable.
 *
 * Bucketing is deterministic: SHA-256( "<featureName>:<appId>" ) is reduced to a
 * 0–99 integer. If that integer is below the effective rolloutPercent, the feature
 * is on. Using the feature name as a prefix means each app lands in an independent
 * bucket for every feature — membership in one rollout does not imply membership
 * in another.
 *
 * The result is automatically recorded as an OTel span attribute
 * `rollout.<featureName>` = "enabled" | "disabled" on the active span, if one exists.
 *
 * @example
 * ```typescript
 * if (isFeatureEnabled('my-feature', context.metadata.appId)) {
 *   // new code path
 * }
 * ```
 */
export function isFeatureEnabled(featureName: FeatureRolloutName, appId: string): boolean {
  const rolloutPercent = resolvePercent(featureName);
  if (rolloutPercent === null) {
    trace.getActiveSpan()?.setAttribute(`rollout.${featureName}`, 'disabled');
    return false;
  }

  const enabled = rolloutPercent > 0 && bucket(`${featureName}:${appId}`) < rolloutPercent;
  trace.getActiveSpan()?.setAttribute(`rollout.${featureName}`, enabled ? 'enabled' : 'disabled');
  return enabled;
}

/**
 * Returns the effective rollout percent (0–100) for a feature, or null if the
 * feature is disabled (master kill-switch off or not registered).
 * Switchboard is checked first; falls back to the ROLLOUTS code config.
 */
function resolvePercent(featureName: string): number | null {
  const sbValue = getSwitchboardValue<number>(`rollout.${featureName}`, -1);
  if (typeof sbValue === 'number' && sbValue >= 0) return sbValue;

  const rollout = ROLLOUTS_MAP[featureName];
  if (!rollout?.enabled) return null;
  return rollout.rolloutPercent;
}

/**
 * Iterates every registered feature rollout and calls isFeatureEnabled for each,
 * ensuring the active OTel span carries a complete and consistent snapshot of all
 * rollout states for the given appId — even for features whose value the current
 * turn never explicitly checks.
 *
 * Call this once at the start of each agent turn (inside the turn span).
 */
export function recordRolloutsOnSpan(appId: string): void {
  for (const name of Object.keys(ROLLOUTS)) {
    isFeatureEnabled(name as FeatureRolloutName, appId);
  }
}

/** Maps an arbitrary string key to a stable bucket in [0, 99]. */
function bucket(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) % 100;
}
