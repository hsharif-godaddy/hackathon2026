export interface FeatureRolloutDefinition {
  description: string;
  // Advisory range 0–100; values outside this degrade gracefully (0 always off,
  // >100 always on since bucket() % 100 never exceeds 99).
  rolloutPercent: number;
  enabled: boolean; // master kill-switch; set to false to disable without removing the entry
}

/**
 * Registry of all controlled feature rollouts.
 *
 * Adding a rollout:
 *   1. Add an entry below with enabled: false and rolloutPercent: 0.
 *   2. Increase rolloutPercent and flip enabled: true to begin the rollout.
 *   3. Once fully rolled out, remove the isFeatureEnabled guard from the code and delete the entry.
 *
 * The hash key used for bucketing is `"<featureName>:<appId>"`, so each app lands in an
 * independent bucket per feature — being in the 10 % cohort for one feature does NOT
 * automatically put the same app in the 10 % cohort for another.
 */
export const ROLLOUTS = {} satisfies Record<string, FeatureRolloutDefinition>;

// Resolves to `string` when the registry is empty (no registered features yet),
// and narrows to a literal union of registered keys once entries are added.
// This ensures callers get compile-time typo detection as soon as a feature is registered.
export type FeatureRolloutName = keyof typeof ROLLOUTS extends never
  ? string
  : keyof typeof ROLLOUTS;
