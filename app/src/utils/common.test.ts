import { describe, expect,it } from 'vitest';

import { formatDate } from './common';

describe('formatDate', () => {
  describe('basic formatting', () => {
    it('should format a Date object in short format', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const result = formatDate(date, false);
      // Format: "Mon DD, YYYY"
      expect(result).toMatch(/Jan 15, 2024/);
    });

    it('should format a date string in short format', () => {
      const dateString = '2024-01-15T10:30:00Z';
      const result = formatDate(dateString, false);
      expect(result).toMatch(/Jan 15, 2024/);
    });

    it('should format a Date object in detailed format', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const result = formatDate(date, true);
      // Format: "Mon DD, YYYY, HH:MM AM/PM"
      expect(result).toContain('Jan 15, 2024');
      expect(result).toMatch(/\d{1,2}:\d{2}/); // Contains time like "10:30"
    });

    it('should format a date string in detailed format', () => {
      const dateString = '2024-01-15T10:30:00Z';
      const result = formatDate(dateString, true);
      expect(result).toContain('Jan 15, 2024');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('default parameter', () => {
    it('should use short format when detailed parameter is omitted', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const result = formatDate(date);
      // Should not contain time
      expect(result).toMatch(/Jan 15, 2024/);
      expect(result).not.toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    });

    it('should use short format when detailed is explicitly false', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const result = formatDate(date, false);
      expect(result).toMatch(/Jan 15, 2024/);
      expect(result).not.toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    });
  });

  describe('date string parsing', () => {
    it('should handle ISO 8601 date string', () => {
      const result = formatDate('2024-03-20T15:45:30Z');
      expect(result).toMatch(/Mar 20, 2024/);
    });

    it('should handle simple date string', () => {
      const result = formatDate('2024-12-25T12:00:00Z');
      expect(result).toMatch(/Dec 25, 2024/);
    });

    it('should handle date string with time', () => {
      const result = formatDate('2024-06-30T18:30:00Z');
      expect(result).toMatch(/Jun 30, 2024/);
    });
  });

  describe('edge cases', () => {
    it('should format beginning of year', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const result = formatDate(date);
      expect(result).toMatch(/Jan 1, 2024/);
    });

    it('should format end of year', () => {
      const date = new Date('2024-12-31T23:59:59Z');
      const result = formatDate(date);
      expect(result).toMatch(/Dec 31, 2024/);
    });

    it('should handle leap year date', () => {
      const date = new Date('2024-02-29T12:00:00Z');
      const result = formatDate(date);
      expect(result).toMatch(/Feb 29, 2024/);
    });

    it('should handle dates from different years', () => {
      const date2020 = new Date('2020-05-15T10:00:00Z');
      const date2025 = new Date('2025-05-15T10:00:00Z');

      const result2020 = formatDate(date2020);
      const result2025 = formatDate(date2025);

      expect(result2020).toMatch(/May 15, 2020/);
      expect(result2025).toMatch(/May 15, 2025/);
    });
  });

  describe('month abbreviations', () => {
    it('should use correct month abbreviations', () => {
      const months = [
        { date: '2024-01-15T12:00:00Z', abbr: 'Jan' },
        { date: '2024-02-15T12:00:00Z', abbr: 'Feb' },
        { date: '2024-03-15T12:00:00Z', abbr: 'Mar' },
        { date: '2024-04-15T12:00:00Z', abbr: 'Apr' },
        { date: '2024-05-15T12:00:00Z', abbr: 'May' },
        { date: '2024-06-15T12:00:00Z', abbr: 'Jun' },
        { date: '2024-07-15T12:00:00Z', abbr: 'Jul' },
        { date: '2024-08-15T12:00:00Z', abbr: 'Aug' },
        { date: '2024-09-15T12:00:00Z', abbr: 'Sep' },
        { date: '2024-10-15T12:00:00Z', abbr: 'Oct' },
        { date: '2024-11-15T12:00:00Z', abbr: 'Nov' },
        { date: '2024-12-15T12:00:00Z', abbr: 'Dec' },
      ];

      months.forEach(({ date, abbr }) => {
        const result = formatDate(date);
        expect(result).toContain(abbr);
      });
    });
  });

  describe('detailed format time display', () => {
    it('should include time in detailed format', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const result = formatDate(date, true);
      expect(result).toContain('Jan 15, 2024');
      // Should contain a time component (format may vary by locale)
      expect(result.length).toBeGreaterThan('Jan 15, 2024'.length);
    });

    it('should not include time in non-detailed format', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const resultShort = formatDate(date, false);
      const resultDetailed = formatDate(date, true);

      // Detailed format should be longer due to time
      expect(resultDetailed.length).toBeGreaterThan(resultShort.length);
    });
  });

  describe('consistency', () => {
    it('should produce consistent results for same input', () => {
      const date = '2024-01-15T10:30:00Z';
      const result1 = formatDate(date);
      const result2 = formatDate(date);
      expect(result1).toBe(result2);
    });

    it('should produce consistent results for equivalent Date and string', () => {
      const dateString = '2024-01-15T10:30:00Z';
      const dateObj = new Date(dateString);
      const resultString = formatDate(dateString);
      const resultObj = formatDate(dateObj);
      expect(resultString).toBe(resultObj);
    });
  });
});
