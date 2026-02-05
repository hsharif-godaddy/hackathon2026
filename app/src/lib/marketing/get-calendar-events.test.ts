import { describe, expect, it } from 'vitest';

import { generateMilestoneEvents, getMonthDateRange } from './get-calendar-events';

describe('get-calendar-events', () => {
  describe('getMonthDateRange', () => {
    it('should return correct date range for January', () => {
      const date = new Date(2024, 0, 15); // January 15, 2024
      const result = getMonthDateRange(date);

      expect(result.startDate).toBe('2024-01-01');
      expect(result.endDate).toBe('2024-01-31');
    });

    it('should return correct date range for February (leap year)', () => {
      const date = new Date(2024, 1, 15); // February 15, 2024 (leap year)
      const result = getMonthDateRange(date);

      expect(result.startDate).toBe('2024-02-01');
      expect(result.endDate).toBe('2024-02-29');
    });

    it('should return correct date range for February (non-leap year)', () => {
      const date = new Date(2023, 1, 15); // February 15, 2023 (non-leap year)
      const result = getMonthDateRange(date);

      expect(result.startDate).toBe('2023-02-01');
      expect(result.endDate).toBe('2023-02-28');
    });

    it('should return correct date range for December', () => {
      const date = new Date(2024, 11, 15); // December 15, 2024
      const result = getMonthDateRange(date);

      expect(result.startDate).toBe('2024-12-01');
      expect(result.endDate).toBe('2024-12-31');
    });

    it('should handle year boundary correctly', () => {
      const date = new Date(2024, 11, 31); // December 31, 2024
      const result = getMonthDateRange(date);

      expect(result.startDate).toBe('2024-12-01');
      expect(result.endDate).toBe('2024-12-31');
    });

    it('should pad single-digit months and days with zeros', () => {
      const date = new Date(2024, 0, 5); // January 5, 2024
      const result = getMonthDateRange(date);

      expect(result.startDate).toBe('2024-01-01');
      // January has 31 days
      expect(result.endDate).toBe('2024-01-31');
    });
  });

  describe('generateMilestoneEvents', () => {
    it('should generate 1 year anniversary event', () => {
      const siteCreatedAt = new Date('2024-01-15T10:00:00Z');
      const month = new Date(2025, 0, 1); // January 2025

      const events = generateMilestoneEvents(siteCreatedAt, month);

      expect(events).toHaveLength(1);
      expect(events[0].name).toContain('1 year');
      expect(events[0].date).toBeInstanceOf(Date);
      const eventDate = events[0].date as Date;
      expect(eventDate.getFullYear()).toBe(2025);
      expect(eventDate.getMonth()).toBe(0); // January
      expect(eventDate.getDate()).toBe(15);
    });

    it('should generate yearly anniversary events', () => {
      const siteCreatedAt = new Date('2020-06-15T10:00:00Z');
      const month = new Date(2024, 5, 1); // June 2024 (4 years later)

      const events = generateMilestoneEvents(siteCreatedAt, month);

      expect(events).toHaveLength(1);
      expect(events[0].name).toContain('4 years');
      const eventDate = events[0].date as Date;
      expect(eventDate.getFullYear()).toBe(2024);
      expect(eventDate.getMonth()).toBe(5); // June
      expect(eventDate.getDate()).toBe(15);
    });

    it('should not generate events for months without anniversaries', () => {
      const siteCreatedAt = new Date('2024-01-15T10:00:00Z');
      const month = new Date(2024, 2, 1); // March 2024 (same year, different month)

      const events = generateMilestoneEvents(siteCreatedAt, month);

      expect(events).toHaveLength(0);
    });

    it('should not generate event for launch month in same year', () => {
      const siteCreatedAt = new Date('2024-01-15T10:00:00Z');
      const month = new Date(2024, 0, 1); // January 2024 (same month/year as creation)

      const events = generateMilestoneEvents(siteCreatedAt, month);

      // No anniversary yet (yearsSinceLaunch = 0)
      expect(events).toHaveLength(0);
    });

    it('should handle leap year edge case for anniversaries', () => {
      const siteCreatedAt = new Date('2024-02-29T10:00:00Z'); // Leap day
      const month = new Date(2025, 1, 1); // February 2025 (non-leap year)

      const events = generateMilestoneEvents(siteCreatedAt, month);

      expect(events).toHaveLength(1);
      const eventDate = events[0].date as Date;
      // JavaScript Date handles this - Feb 29 in leap year becomes March 1 in non-leap year
      // So we check if it's either end of February or start of March
      const isEndOfFebOrStartOfMarch =
        (eventDate.getMonth() === 1 && eventDate.getDate() >= 28) || // Feb 28-29
        (eventDate.getMonth() === 2 && eventDate.getDate() === 1);   // March 1
      expect(isEndOfFebOrStartOfMarch).toBe(true);
    });

    it('should include content ideas for milestone events', () => {
      const siteCreatedAt = new Date('2023-01-15T10:00:00Z');
      const month = new Date(2024, 0, 1); // January 2024

      const events = generateMilestoneEvents(siteCreatedAt, month);

      expect(events[0].contentIdeas).toBeDefined();
      expect(events[0].contentIdeas?.length).toBeGreaterThan(0);
    });

    it('should handle very old sites correctly', () => {
      const siteCreatedAt = new Date('2010-01-01T10:00:00Z');
      const month = new Date(2024, 0, 1); // January 2024 (14 years later)

      const events = generateMilestoneEvents(siteCreatedAt, month);

      expect(events).toHaveLength(1);
      expect(events[0].name).toContain('14 years');
      const eventDate = events[0].date as Date;
      expect(eventDate.getFullYear()).toBe(2024);
    });

    it('should not generate events for future site creation dates', () => {
      const siteCreatedAt = new Date('2025-06-15T10:00:00Z'); // Future date
      const month = new Date(2024, 5, 1); // June 2024

      const events = generateMilestoneEvents(siteCreatedAt, month);

      expect(events).toHaveLength(0);
    });

    it('should include category and isCustom flags', () => {
      const siteCreatedAt = new Date('2023-01-15T10:00:00Z');
      const month = new Date(2024, 0, 1); // January 2024

      const events = generateMilestoneEvents(siteCreatedAt, month);

      expect(events[0].category).toBe('milestone');
      expect(events[0].isCustom).toBe(true);
    });
  });
});
