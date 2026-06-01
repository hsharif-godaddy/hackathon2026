import { describe, expect, it } from 'vitest';

import { AGENT_ID_PREFIX, formatAgentId } from './format-agent-id';

describe('format-agent-id', function formatAgentIdTests() {
  describe('#formatAgentId', function format() {
    it('prefixes the agent name with the canonical id prefix', function prefix() {
      expect(formatAgentId('InitialAgent')).toBe(`${AGENT_ID_PREFIX}InitialAgent`);
    });
  });
});
