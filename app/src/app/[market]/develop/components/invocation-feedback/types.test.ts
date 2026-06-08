import { describe, expect, it } from 'vitest';

import { feedbackCategoryForReason, invocationFeedbackVoteFromMetadata } from './types';

describe('invocation-feedback types', function typesTests() {
  describe('#invocationFeedbackVoteFromMetadata', function voteFromMetadata() {
    it('reads persisted positive and negative feedback', function read() {
      expect(invocationFeedbackVoteFromMetadata({ feedback: 'positive' })).toBe('positive');
      expect(invocationFeedbackVoteFromMetadata({ feedback: 'negative' })).toBe('negative');
      expect(invocationFeedbackVoteFromMetadata({ feedback: 'invalid' })).toBe(null);
      expect(invocationFeedbackVoteFromMetadata(undefined)).toBe(null);
    });
  });

  describe('#feedbackCategoryForReason', function category() {
    it('maps each reason id to the Event Bus category label', function map() {
      expect(feedbackCategoryForReason('not_factually_correct')).toBe('Not accurate');
      expect(feedbackCategoryForReason('other')).toBe('Other');
    });
  });
});
