import { describe, expect, it } from 'vitest';

import {
    DEFAULT_LOG_PRESET,
    LOG_PRESET_VALUES,
    resolveInitialPreset,
    resolveSyncedPreset,
} from '@/lib/log-time-range';

describe('log-time-range', () => {
    describe('resolveInitialPreset', () => {
        it('returns the parent preset when it is a supported value', () => {
            for (const preset of LOG_PRESET_VALUES) {
                expect(resolveInitialPreset(preset)).toBe(preset);
            }
        });

        it('falls back to the default when the prop is undefined', () => {
            expect(resolveInitialPreset(undefined)).toBe(DEFAULT_LOG_PRESET);
        });

        it('falls back to the default when the prop is empty', () => {
            expect(resolveInitialPreset('')).toBe(DEFAULT_LOG_PRESET);
        });

        it('falls back to the default when the prop is not a known preset', () => {
            expect(resolveInitialPreset('5y')).toBe(DEFAULT_LOG_PRESET);
            expect(resolveInitialPreset('all')).toBe(DEFAULT_LOG_PRESET);
            expect(resolveInitialPreset('custom')).toBe(DEFAULT_LOG_PRESET);
        });
    });

    describe('resolveSyncedPreset', () => {
        it('returns null while the user is on a custom range, even when the prop is set', () => {
            expect(resolveSyncedPreset('24h', 'custom')).toBeNull();
            expect(resolveSyncedPreset('7d', 'custom')).toBeNull();
        });

        it('returns null when the parent prop is undefined', () => {
            expect(resolveSyncedPreset(undefined, 'preset')).toBeNull();
        });

        it('returns null when the parent prop is empty', () => {
            expect(resolveSyncedPreset('', 'preset')).toBeNull();
        });

        it('returns null when the parent prop is not a supported preset', () => {
            expect(resolveSyncedPreset('30d', 'preset')).toBeNull();
            expect(resolveSyncedPreset('all', 'preset')).toBeNull();
            expect(resolveSyncedPreset('garbage', 'preset')).toBeNull();
        });

        it('returns the parent preset when it is a supported value', () => {
            expect(resolveSyncedPreset('24h', 'preset')).toBe('24h');
            expect(resolveSyncedPreset('7d', 'preset')).toBe('7d');
            expect(resolveSyncedPreset('15m', 'preset')).toBe('15m');
        });

        it('returns every supported preset when passed back through', () => {
            for (const preset of LOG_PRESET_VALUES) {
                expect(resolveSyncedPreset(preset, 'preset')).toBe(preset);
            }
        });

        it('does NOT compare against the local preset (intentional — see jsdoc)', () => {
            // The whole point: the local preset is irrelevant to the decision.
            // This guards against a regression where a `currentPreset` arg gets
            // re-introduced and starts overwriting user-driven dropdown changes.
            expect(resolveSyncedPreset.length).toBe(2);
        });
    });
});
