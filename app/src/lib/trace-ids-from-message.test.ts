import { describe, expect, it } from 'vitest';

import { traceIdsFromMessage } from './trace-ids-from-message';

describe('trace-ids-from-message', function traceIdsTests() {
  describe('#traceIdsFromMessage', function fromMessage() {
    it('returns trace, observation, and agent fields from metadata', function full() {
      expect(
        traceIdsFromMessage({
          metadata: {
            traceId: 'trace-1',
            observationId: 'obs-1',
            agentId: 'InitialAgent',
          },
        })
      ).toEqual({
        traceId: 'trace-1',
        observationId: 'obs-1',
        agentName: 'InitialAgent',
      });
    });

    it('returns partial context when only agentId is present', function agentOnly() {
      expect(
        traceIdsFromMessage({
          metadata: { agentId: 'DevelopAgent' },
        })
      ).toEqual({ agentName: 'DevelopAgent' });
    });

    it('returns null when metadata is missing or empty', function empty() {
      expect(traceIdsFromMessage({})).toBeNull();
      expect(traceIdsFromMessage({ metadata: {} })).toBeNull();
    });
  });
});
