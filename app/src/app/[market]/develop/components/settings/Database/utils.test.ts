import { describe, expect, it } from 'vitest';

import {
  formatDateForForm,
  formatDateForMySQL,
  formatDateTimeForForm,
  formatDateTimeForMySQL,
  isDateColumnType,
  isDateTimeColumnType,
} from './utils';

describe('Database utils', function databaseUtilsTests() {
  describe('#isDateColumnType', function isDateColumnTypeTests() {
    it('matches date and ignores precision', function dateVariants() {
      expect(isDateColumnType('date')).toBe(true);
      expect(isDateColumnType('DATE')).toBe(true);
      expect(isDateColumnType(' date ')).toBe(true);
    });

    it('does not match datetime or timestamp', function dateBoundary() {
      expect(isDateColumnType('datetime')).toBe(false);
      expect(isDateColumnType('datetime(6)')).toBe(false);
      expect(isDateColumnType('timestamp')).toBe(false);
    });
  });

  describe('#isDateTimeColumnType', function isDateTimeColumnTypeTests() {
    it('matches datetime and timestamp variants', function datetimeVariants() {
      expect(isDateTimeColumnType('datetime')).toBe(true);
      expect(isDateTimeColumnType('DATETIME(6)')).toBe(true);
      expect(isDateTimeColumnType(' timestamp ')).toBe(true);
      expect(isDateTimeColumnType('timestamp(3)')).toBe(true);
    });

    it('does not match date', function datetimeBoundary() {
      expect(isDateTimeColumnType('date')).toBe(false);
    });
  });

  describe('#formatDateForForm', function formatDateForFormTests() {
    it('returns empty string for null and undefined', function emptyInputs() {
      expect(formatDateForForm(null)).toBe('');
      expect(formatDateForForm(undefined)).toBe('');
    });

    it('extracts YYYY-MM-DD from ISO strings', function isoDate() {
      expect(formatDateForForm('2026-07-01T00:00:00.000Z')).toBe('2026-07-01');
    });

    it('passes through values without a date prefix', function passThrough() {
      expect(formatDateForForm('not-a-date')).toBe('not-a-date');
    });
  });

  describe('#formatDateForMySQL', function formatDateForMySQLTests() {
    it('converts ISO strings to MySQL date format', function isoToMysql() {
      expect(formatDateForMySQL('2026-07-01T00:00:00.000Z')).toBe('2026-07-01');
    });

    it('is idempotent for MySQL date strings', function idempotent() {
      expect(formatDateForMySQL('2026-07-01')).toBe('2026-07-01');
    });

    it('passes through malformed input', function passThrough() {
      expect(formatDateForMySQL('bad-value')).toBe('bad-value');
    });
  });

  describe('#formatDateTimeForForm', function formatDateTimeForFormTests() {
    it('returns empty string for null and undefined', function emptyInputs() {
      expect(formatDateTimeForForm(null)).toBe('');
      expect(formatDateTimeForForm(undefined)).toBe('');
    });

    it('converts ISO-with-Z to MySQL datetime display', function isoWithZ() {
      expect(formatDateTimeForForm('2026-12-31T18:29:00.000Z')).toBe('2026-12-31 18:29:00');
    });

    it('truncates sub-second precision from ISO strings', function subSecondTruncation() {
      expect(formatDateTimeForForm('2026-12-31T18:29:00.123Z')).toBe('2026-12-31 18:29:00');
    });

    it('passes through values without an ISO datetime prefix', function passThrough() {
      expect(formatDateTimeForForm('2026-12-31 18:29:00')).toBe('2026-12-31 18:29:00');
      expect(formatDateTimeForForm('bad-value')).toBe('bad-value');
    });
  });

  describe('#formatDateTimeForMySQL', function formatDateTimeForMySQLTests() {
    it('converts ISO-with-Z to MySQL datetime format', function isoWithZ() {
      expect(formatDateTimeForMySQL('2026-12-31T18:29:00.000Z')).toBe('2026-12-31 18:29:00');
    });

    it('is idempotent for MySQL datetime strings', function idempotent() {
      expect(formatDateTimeForMySQL('2026-12-31 18:29:00')).toBe('2026-12-31 18:29:00');
    });

    it('appends :00 to short HH:MM MySQL values', function shortTime() {
      expect(formatDateTimeForMySQL('2026-12-31 18:29')).toBe('2026-12-31 18:29:00');
    });

    it('truncates sub-second precision from ISO strings', function subSecondTruncation() {
      expect(formatDateTimeForMySQL('2026-12-31T18:29:00.999Z')).toBe('2026-12-31 18:29:00');
    });

    it('passes through malformed input', function passThrough() {
      expect(formatDateTimeForMySQL('not-a-datetime')).toBe('not-a-datetime');
    });
  });
});
