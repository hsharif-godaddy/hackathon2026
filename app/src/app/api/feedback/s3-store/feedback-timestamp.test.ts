import { describe, expect, it } from 'vitest';

import { parseFeedbackUtcStringToDate } from './feedback-timestamp';

describe('feedback-timestamp', function feedbackTimestampTests() {
  describe('#parseFeedbackUtcStringToDate', function parseTsTests() {
    it('should parse ISO with explicit Z as UTC', function parseZ() {
      const d = parseFeedbackUtcStringToDate('2024-03-15T14:30:00.000Z');
      expect(d.toISOString()).toBe('2024-03-15T14:30:00.000Z');
    });

    it('should parse ISO with numeric timezone offset', function parseOffset() {
      const d = parseFeedbackUtcStringToDate('2024-03-15T10:00:00.000-04:00');
      expect(d.toISOString()).toBe('2024-03-15T14:00:00.000Z');
    });

    it('should parse ISO with compact offset +hhmm', function parseCompactOffset() {
      const d = parseFeedbackUtcStringToDate('2024-03-15T12:00:00+0530');
      expect(d.toISOString()).toBe('2024-03-15T06:30:00.000Z');
    });

    it('should append Z for naive ISO without offset', function parseNaiveIso() {
      const d = parseFeedbackUtcStringToDate('2024-06-01T08:15:30');
      expect(d.toISOString()).toBe('2024-06-01T08:15:30.000Z');
    });

    it('should parse formatUtcTs style space-separated UTC', function parseSpaceUtc() {
      const d = parseFeedbackUtcStringToDate('2024-01-02 03:04:05');
      expect(d.toISOString()).toBe('2024-01-02T03:04:05.000Z');
    });

    it('should trim leading and trailing whitespace', function trim() {
      const d = parseFeedbackUtcStringToDate('  2024-01-02T00:00:00Z  ');
      expect(d.toISOString()).toBe('2024-01-02T00:00:00.000Z');
    });

    it('should throw on empty string', function empty() {
      expect(() => parseFeedbackUtcStringToDate('')).toThrow('empty timestamp string');
      expect(() => parseFeedbackUtcStringToDate('   ')).toThrow('empty timestamp string');
    });

    it('should throw on invalid ISO', function invalidIso() {
      expect(() => parseFeedbackUtcStringToDate('2024-13-40T99:99:99Z')).toThrow('invalid timestamp');
    });

    it('should throw on invalid space format', function invalidSpace() {
      expect(() => parseFeedbackUtcStringToDate('not-a-date 12:00:00')).toThrow('invalid timestamp');
    });
  });
});
