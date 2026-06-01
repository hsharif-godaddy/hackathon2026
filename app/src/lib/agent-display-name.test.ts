import { describe, expect, it } from 'vitest';

import {
  parseAgentKeyFromTargetId,
  resolveAgentDisplayName,
} from './agent-display-name';

describe('agent-display-name', function agentDisplayNameTests() {
  describe('#parseAgentKeyFromTargetId', function parse() {
    it('strips the airo-app-builder prefix', function strip() {
      expect(parseAgentKeyFromTargetId('airo-app-builder-initial-agent')).toBe('initial-agent');
    });

    it('returns the raw id when no prefix is present', function raw() {
      expect(parseAgentKeyFromTargetId('InitialAgent')).toBe('InitialAgent');
    });

    it('returns null for empty input', function empty() {
      expect(parseAgentKeyFromTargetId('')).toBeNull();
    });
  });

  describe('#resolveAgentDisplayName', function resolve() {
    it('prefers catalog name when the agent key matches', function catalog() {
      expect(
        resolveAgentDisplayName('initial-agent', [
          { id: 'initial-agent', name: 'Initial Agent' },
        ])
      ).toBe('Initial Agent');
    });

    it('falls back to step_start display name', function stepStart() {
      expect(resolveAgentDisplayName('initial-agent', [], 'Develop Agent')).toBe('Develop Agent');
    });

    it('humanizes the agent key when no catalog or display name exists', function humanize() {
      expect(resolveAgentDisplayName('initial-agent', [])).toBe('Initial Agent');
    });

    it('returns Agent when no key is provided', function defaultLabel() {
      expect(resolveAgentDisplayName(null, [])).toBe('Agent');
    });
  });
});
