/**
 * Read a boolean feature flag. Returns `undefined` during SSR or if the key
 * is not in the loaded tree. Pure function - no hooks - safe to call from
 * anywhere.
 */
export function getSwitchboardFlag(featureName: string): boolean | undefined {
  if (typeof window === 'undefined') return undefined;

  const value = window.gasketData?.switchboard?.[featureName];
  return typeof value === 'boolean' ? value : undefined;
}

/** Alias that satisfies the React hooks naming convention at component call sites. */
export const useSwitchboard = getSwitchboardFlag;
