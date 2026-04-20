// Shared time-range helpers for the LogsPanel. Kept in a plain .ts module
// (no React) so they can be unit-tested without a DOM environment.

export const LOG_TIME_PRESETS = [
    { label: 'Last 15 min', value: '15m' },
    { label: 'Last 1 hour', value: '1h' },
    { label: 'Last 6 hours', value: '6h' },
    { label: 'Last 24 hours', value: '24h' },
    { label: 'Last 7 days', value: '7d' },
    { label: 'Last 14 days', value: '14d' },
] as const;

export type LogTimePreset = typeof LOG_TIME_PRESETS[number]['value'];

export const LOG_PRESET_VALUES: readonly string[] = LOG_TIME_PRESETS.map(p => p.value);

export const DEFAULT_LOG_PRESET: LogTimePreset = '1h';

export type RangeMode = 'preset' | 'custom';

/**
 * Pick the preset value to render on first mount given the parent-supplied
 * `timeRange` prop. Falls back to {@link DEFAULT_LOG_PRESET} when the prop is
 * missing or not one of the supported presets.
 */
export function resolveInitialPreset(timeRange: string | undefined): string {
    if (timeRange && LOG_PRESET_VALUES.includes(timeRange)) {
        return timeRange;
    }
    return DEFAULT_LOG_PRESET;
}

/**
 * Decides what preset (if any) the panel should adopt from the parent-supplied
 * `timeRange` prop.
 *
 * Returns `null` when the user is on a custom range, the prop is missing, or
 * the prop isn't one of the supported presets — in those cases the panel
 * should keep whatever local preset it already has.
 *
 * IMPORTANT: this function intentionally does NOT compare against the panel's
 * current preset. The caller's effect should depend only on the parent prop +
 * `rangeMode`, not on the local preset; otherwise a user-driven dropdown
 * change would re-trigger the effect and get overwritten back to the parent
 * value. React already dedupes `setState` calls with the same value, so an
 * occasional no-op set is free.
 */
export function resolveSyncedPreset(
    parentTimeRange: string | undefined,
    rangeMode: RangeMode,
): string | null {
    if (rangeMode === 'custom') return null;
    if (!parentTimeRange) return null;
    if (!LOG_PRESET_VALUES.includes(parentTimeRange)) return null;
    return parentTimeRange;
}
