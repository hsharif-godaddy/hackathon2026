import { describe, expect, it } from 'vitest';

import { feedbackCategoryForReason } from './types';

describe('invocation-feedback types', function typesTests() {
  describe('#feedbackCategoryForReason', function category() {
    it('maps each reason id to the Event Bus category label', function map() {
      expect(feedbackCategoryForReason('not_factually_correct')).toBe('Not accurate');
      expect(feedbackCategoryForReason('other')).toBe('Other');
    });
  });
});
