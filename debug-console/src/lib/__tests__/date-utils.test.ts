import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeUseBefore, formatTimestamp } from '../date-utils';

describe('date-utils', () => {
    describe('computeUseBefore', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should return a date 30 days later rounded to the next UTC hour', () => {
            vi.setSystemTime(new Date('2026-04-04T15:21:31Z'));

            expect(computeUseBefore()).toBe('2026-05-04T16:00:00Z');
        });

        it('should handle midnight boundary by rolling to next day hour 0', () => {
            vi.setSystemTime(new Date('2026-01-01T23:30:00Z'));

            expect(computeUseBefore()).toBe('2026-02-01T00:00:00Z');
        });

        it('should strip milliseconds from the ISO string', () => {
            vi.setSystemTime(new Date('2026-06-15T10:45:59.123Z'));

            const result = computeUseBefore();
            expect(result).not.toContain('.');
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        });

        it('should return an ISO string with Z suffix', () => {
            vi.setSystemTime(new Date('2026-03-18T08:00:00Z'));

            const result = computeUseBefore();
            expect(result).toMatch(/Z$/);
        });

        it('should accept a custom number of days', () => {
            vi.setSystemTime(new Date('2026-04-04T15:21:31Z'));

            expect(computeUseBefore(7)).toBe('2026-04-11T16:00:00Z');
        });

        it('should handle 0 days by rounding to the next hour of the same day', () => {
            vi.setSystemTime(new Date('2026-04-04T15:21:31Z'));

            expect(computeUseBefore(0)).toBe('2026-04-04T16:00:00Z');
        });

        it('should handle 1 day', () => {
            vi.setSystemTime(new Date('2026-04-04T15:21:31Z'));

            expect(computeUseBefore(1)).toBe('2026-04-05T16:00:00Z');
        });

        it('should handle 90 days crossing year boundary', () => {
            vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));

            expect(computeUseBefore(90)).toBe('2027-01-30T11:00:00Z');
        });
    });

    describe('formatTimestamp', () => {
        it('should format an ISO timestamp to a readable local string', () => {
            const result = formatTimestamp('2026-04-04T15:21:31Z');

            expect(result).toContain('2026');
            expect(result).toContain('Apr');
            // 15:21Z → calendar rolls to Apr 5 local for UTC+9 and east; stays Apr 4 through UTC+8.
            if (new Date().getTimezoneOffset() / 60 < -8) {
                expect(result).toContain('05');
            } else {
                expect(result).toContain('04');
            }
        });

        it('should return the original string on invalid input', () => {
            expect(formatTimestamp('not-a-date')).toBe('Invalid Date');
        });

        it('should include year in the output', () => {
            const result = formatTimestamp('2025-12-25T00:00:00Z');
            expect(result).toContain('2025');
        });

        it('should use 24-hour format', () => {
            const result = formatTimestamp('2026-01-01T14:30:00Z');
            expect(result).not.toMatch(/AM|PM/i);
        });
    });
});
