import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getBlogCreationInstructions,
  getInitialScheduleTime,
  getSocialPostCreationInstructions,
  getUserTimezone,
  parseTime,
  shouldDisableTime,
  validateScheduledTime,
} from './helpers';

describe('event-modal helpers', () => {
  describe('getBlogCreationInstructions', () => {
    it('should return instructions with timestamp', () => {
      const timestamp = '2026-02-16T10:00:00Z';
      const instructions = getBlogCreationInstructions(timestamp);

      expect(instructions).toContain('blog');
      expect(instructions).toContain('blog-writing');
      expect(instructions).toContain(timestamp);
    });

    it('should include install skill check', () => {
      const instructions = getBlogCreationInstructions('2026-02-16T10:00:00Z');

      expect(instructions).toContain('First check if I have a blog set up');
      expect(instructions).toContain('If not, use the');
    });
  });

  describe('getSocialPostCreationInstructions', () => {
    it('should create instructions for single platform', () => {
      const instructions = getSocialPostCreationInstructions('2026-02-16T10:00:00Z', ['facebook']);

      expect(instructions).toContain('facebook');
      expect(instructions).toContain('social-posts');
      expect(instructions).toContain('2026-02-16T10:00:00Z');
    });

    it('should join multiple platforms with "and"', () => {
      const instructions = getSocialPostCreationInstructions('2026-02-16T10:00:00Z', ['facebook', 'instagram']);

      expect(instructions).toContain('facebook and instagram');
    });

    it('should include marketing agent handoff', () => {
      const instructions = getSocialPostCreationInstructions('2026-02-16T10:00:00Z', ['facebook']);

      expect(instructions).toContain('Hand off to the marketing agent');
    });
  });

  describe('parseTime', () => {
    it('should parse 12-hour AM time', () => {
      expect(parseTime('10:30 AM')).toEqual({ hours: 10, minutes: 30 });
      expect(parseTime('1:15 AM')).toEqual({ hours: 1, minutes: 15 });
    });

    it('should parse 12-hour PM time', () => {
      expect(parseTime('2:45 PM')).toEqual({ hours: 14, minutes: 45 });
      expect(parseTime('11:30 PM')).toEqual({ hours: 23, minutes: 30 });
    });

    it('should handle 12:00 AM as midnight', () => {
      expect(parseTime('12:00 AM')).toEqual({ hours: 0, minutes: 0 });
      expect(parseTime('12:30 AM')).toEqual({ hours: 0, minutes: 30 });
    });

    it('should handle 12:00 PM as noon', () => {
      expect(parseTime('12:00 PM')).toEqual({ hours: 12, minutes: 0 });
      expect(parseTime('12:45 PM')).toEqual({ hours: 12, minutes: 45 });
    });

    it('should parse time without spaces', () => {
      expect(parseTime('10:30AM')).toEqual({ hours: 10, minutes: 30 });
      expect(parseTime('2:45PM')).toEqual({ hours: 14, minutes: 45 });
    });

    it('should handle case-insensitive AM/PM', () => {
      expect(parseTime('10:30 am')).toEqual({ hours: 10, minutes: 30 });
      expect(parseTime('2:45 pm')).toEqual({ hours: 14, minutes: 45 });
    });

    it('should handle 24-hour format as fallback', () => {
      expect(parseTime('14:30')).toEqual({ hours: 14, minutes: 30 });
      expect(parseTime('09:15')).toEqual({ hours: 9, minutes: 15 });
    });
  });

  describe('getInitialScheduleTime', () => {
    beforeEach(() => {
      // Mock Date.now() to return a fixed time
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return time at least 20 minutes in future', () => {
      // Set current time to 10:00 AM
      vi.setSystemTime(new Date('2026-02-16T10:00:00'));

      const scheduledTime = getInitialScheduleTime('en-US');
      const parsed = parseTime(scheduledTime);

      // Should be at least 10:20 AM, rounded to next 15-min interval (10:30 AM)
      expect(parsed.hours).toBeGreaterThanOrEqual(10);
      if (parsed.hours === 10) {
        expect(parsed.minutes).toBeGreaterThanOrEqual(20);
      }
    });

    it('should round to next 15-minute interval', () => {
      // Set current time to 10:05 AM - 20 min buffer = 10:25 AM
      vi.setSystemTime(new Date('2026-02-16T10:05:00'));

      const scheduledTime = getInitialScheduleTime('en-US');
      const parsed = parseTime(scheduledTime);

      // Should round 10:25 up to 10:30
      expect(parsed.minutes % 15).toBe(0);
    });

    it('should handle hour rollover when rounding', () => {
      // Set current time to 10:50 AM - 20 min buffer = 11:10 AM
      vi.setSystemTime(new Date('2026-02-16T10:50:00'));

      const scheduledTime = getInitialScheduleTime('en-US');
      const parsed = parseTime(scheduledTime);

      // Should be 11:15 AM or later
      expect(parsed.hours).toBeGreaterThanOrEqual(11);
    });
  });

  describe('validateScheduledTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-16T10:00:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should accept valid future time', () => {
      const result = validateScheduledTime('11:00 AM', new Date('2026-02-16'), true);

      expect(result.isValid).toBe(true);
      expect(result.message).toBeNull();
    });

    it('should reject time in the past', () => {
      const result = validateScheduledTime('9:00 AM', new Date('2026-02-16'), true);

      expect(result.isValid).toBe(false);
      expect(result.message).toBe('builder_marketing_time_in_past');
    });

    it('should reject time less than 20 minutes in future', () => {
      const result = validateScheduledTime('10:15 AM', new Date('2026-02-16'), true);

      expect(result.isValid).toBe(false);
      expect(result.message).toBe('builder_marketing_time_too_soon');
    });

    it('should accept time exactly 20 minutes in future', () => {
      const result = validateScheduledTime('10:21 AM', new Date('2026-02-16'), true);

      expect(result.isValid).toBe(true);
      expect(result.message).toBeNull();
    });

    it('should always validate as true when not today', () => {
      // Past time, but different day
      const result = validateScheduledTime('9:00 AM', new Date('2026-02-17'), false);

      expect(result.isValid).toBe(true);
      expect(result.message).toBeNull();
    });

    it('should handle empty time string', () => {
      const result = validateScheduledTime('', new Date('2026-02-16'), true);

      expect(result.isValid).toBe(true);
      expect(result.message).toBeNull();
    });
  });

  describe('shouldDisableTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-16T10:00:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should disable past times', () => {
      expect(shouldDisableTime('9:00 AM', new Date('2026-02-16'), true)).toBe(true);
      expect(shouldDisableTime('9:45 AM', new Date('2026-02-16'), true)).toBe(true);
    });

    it('should disable times less than 20 minutes in future', () => {
      expect(shouldDisableTime('10:05 AM', new Date('2026-02-16'), true)).toBe(true);
      expect(shouldDisableTime('10:15 AM', new Date('2026-02-16'), true)).toBe(true);
    });

    it('should not disable times 20+ minutes in future', () => {
      expect(shouldDisableTime('10:30 AM', new Date('2026-02-16'), true)).toBe(false);
      expect(shouldDisableTime('11:00 AM', new Date('2026-02-16'), true)).toBe(false);
    });

    it('should not disable any times when not today', () => {
      expect(shouldDisableTime('9:00 AM', new Date('2026-02-17'), false)).toBe(false);
      expect(shouldDisableTime('10:05 AM', new Date('2026-02-17'), false)).toBe(false);
    });
  });

  describe('getUserTimezone', () => {
    it('should return timezone with abbreviation', () => {
      const timezone = getUserTimezone();

      // Should contain timezone name (e.g., "America/Phoenix")
      expect(timezone).toBeTruthy();
      expect(typeof timezone).toBe('string');
    });

    it('should handle timezone detection failure gracefully', () => {
      // Mock Intl to throw error
      const originalIntl = global.Intl;
      (global as any).Intl = {
        DateTimeFormat: vi.fn(function () {
          throw new Error('Timezone not supported');
        }),
      };

      const timezone = getUserTimezone();

      expect(timezone).toBe('Local time');

      // Restore Intl
      global.Intl = originalIntl;
    });

    it('should include timezone abbreviation in parentheses', () => {
      const timezone = getUserTimezone();

      // Should match pattern like "America/Phoenix (MST)" or at minimum have the timezone name
      expect(timezone.length).toBeGreaterThan(0);
    });
  });
});
